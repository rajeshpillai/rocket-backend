defmodule Rocket.Engine.WebhookEngine do
  @moduledoc "Webhook dispatch engine: async/sync webhooks, condition evaluation, delivery logging."

  alias Rocket.Store.Postgres
  alias Rocket.Metadata.Registry
  alias Rocket.Engine.Expression

  require Logger

  @http_timeout 30_000

  # ── Payload ──

  def build_webhook_payload(hook, entity, action, record, old, user) do
    changes = compute_changes(record, old)

    user_map =
      case user do
        %{"id" => id, "roles" => roles} -> %{"id" => id, "roles" => roles}
        %{id: id, roles: roles} -> %{"id" => id, "roles" => roles}
        _ -> nil
      end

    %{
      "event" => hook,
      "entity" => entity,
      "action" => action,
      "record" => record || %{},
      "old" => old || %{},
      "changes" => changes,
      "user" => user_map,
      "timestamp" => DateTime.utc_now() |> DateTime.to_iso8601(),
      "idempotency_key" => "wh_#{Ecto.UUID.generate()}"
    }
  end

  defp compute_changes(record, old) when is_map(record) and is_map(old) do
    Map.keys(record)
    |> Enum.reduce(%{}, fn key, acc ->
      new_val = Map.get(record, key)
      old_val = Map.get(old, key)

      if "#{new_val}" != "#{old_val}" do
        Map.put(acc, key, %{"old" => old_val, "new" => new_val})
      else
        acc
      end
    end)
  end

  defp compute_changes(_, _), do: %{}

  # ── Headers ──

  def resolve_headers(headers) when is_map(headers) do
    Map.new(headers, fn {k, v} ->
      resolved = Regex.replace(~r/\{\{env\.(\w+)\}\}/, v, fn _, var_name ->
        System.get_env(var_name) || ""
      end)
      {k, resolved}
    end)
  end

  def resolve_headers(_), do: %{}

  # ── Condition ──

  def evaluate_webhook_condition(nil, _payload), do: {:ok, true}
  def evaluate_webhook_condition("", _payload), do: {:ok, true}

  def evaluate_webhook_condition(condition, payload) do
    env = %{
      "record" => payload["record"],
      "old" => payload["old"],
      "changes" => payload["changes"],
      "action" => payload["action"],
      "entity" => payload["entity"],
      "event" => payload["event"],
      "user" => payload["user"]
    }

    Expression.evaluate_bool(condition, env)
  end

  # ── Dispatch ──

  def dispatch_webhook(url, method, headers, body_json) do
    method_atom = method |> String.downcase() |> String.to_atom()
    resolved = resolve_headers(headers)

    req_headers =
      [{"content-type", "application/json"}] ++
        Enum.map(resolved, fn {k, v} -> {k, v} end)

    try do
      case Req.request(
             method: method_atom,
             url: url,
             body: body_json,
             headers: req_headers,
             receive_timeout: @http_timeout
           ) do
        {:ok, %{status: status, body: body}} ->
          resp_body = if is_binary(body), do: body, else: Jason.encode!(body)
          resp_body = String.slice(resp_body, 0, 65_536)
          %{status_code: status, response_body: resp_body, error: nil}

        {:error, err} ->
          %{status_code: 0, response_body: "", error: inspect(err)}
      end
    rescue
      e ->
        %{status_code: 0, response_body: "", error: inspect(e)}
    end
  end

  # ── Logging ──

  def log_webhook_delivery(conn, wh, payload, headers, _body_json, result) do
    status =
      cond do
        result.error == nil && result.status_code >= 200 && result.status_code < 300 ->
          "delivered"

        (wh.retry && wh.retry.max_attempts || 1) > 1 ->
          "retrying"

        true ->
          "failed"
      end

    max_attempts = if wh.retry, do: wh.retry.max_attempts, else: 1

    next_retry =
      if status == "retrying" do
        DateTime.utc_now() |> DateTime.add(30, :second)
      else
        nil
      end

    error_msg =
      cond do
        result.error != nil -> result.error
        result.status_code >= 300 -> "HTTP #{result.status_code}"
        true -> nil
      end

    Postgres.exec(conn,
      """
      INSERT INTO _webhook_logs
        (webhook_id, entity, hook, url, method, request_headers, request_body,
         response_status, response_body, status, attempt, max_attempts, next_retry_at, error, idempotency_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      """,
      [wh.id, wh.entity, wh.hook, wh.url, wh.method, headers || %{}, payload,
       result.status_code, result.response_body, status, 1, max_attempts,
       next_retry, error_msg, payload["idempotency_key"]])
  end

  # ── Async Fire ──

  def fire_async_webhooks(conn, registry, hook, entity, action, record, old, user) do
    webhooks = Registry.get_webhooks_for_entity_hook(registry, entity, hook)

    async_hooks = Enum.filter(webhooks, & &1.async)

    if async_hooks != [] do
      payload = build_webhook_payload(hook, entity, action, record, old, user)
      body_json = Jason.encode!(payload)

      Enum.each(async_hooks, fn wh ->
        case evaluate_webhook_condition(wh.condition, payload) do
          {:ok, true} ->
            Task.start(fn ->
              headers = wh.headers || %{}
              result = dispatch_webhook(wh.url, wh.method || "POST", headers, body_json)
              log_webhook_delivery(conn, wh, payload, headers, body_json, result)
            end)

          _ ->
            :ok
        end
      end)
    end
  end

  # ── Sync Fire ──

  def fire_sync_webhooks(conn, registry, hook, entity, action, record, old, user) do
    webhooks = Registry.get_webhooks_for_entity_hook(registry, entity, hook)

    sync_hooks = Enum.filter(webhooks, &(!&1.async))

    if sync_hooks == [] do
      :ok
    else
      payload = build_webhook_payload(hook, entity, action, record, old, user)
      body_json = Jason.encode!(payload)

      Enum.reduce_while(sync_hooks, :ok, fn wh, :ok ->
        case evaluate_webhook_condition(wh.condition, payload) do
          {:ok, true} ->
            headers = wh.headers || %{}
            result = dispatch_webhook(wh.url, wh.method || "POST", headers, body_json)
            log_webhook_delivery(conn, wh, payload, headers, body_json, result)

            if result.error == nil && result.status_code >= 200 && result.status_code < 300 do
              {:cont, :ok}
            else
              msg = result.error || "HTTP #{result.status_code}"
              {:halt, {:error, "sync webhook failed (#{wh.id}): #{msg}"}}
            end

          _ ->
            {:cont, :ok}
        end
      end)
    end
  end

  # ── Direct Dispatch (for state machines / workflows) ──

  def dispatch_webhook_direct(url, method, headers, body) do
    dispatch_webhook(url, method || "POST", headers || %{}, body)
  end
end
