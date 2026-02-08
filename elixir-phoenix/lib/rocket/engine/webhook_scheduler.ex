defmodule Rocket.Engine.WebhookScheduler do
  @moduledoc "Background GenServer that retries failed webhook deliveries on a 30s tick."
  use GenServer
  require Logger

  alias Rocket.Store.Postgres
  alias Rocket.Engine.WebhookEngine

  @tick_interval 30_000

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    schedule_tick()
    {:ok, %{}}
  end

  @impl true
  def handle_info(:tick, state) do
    process_retries()
    schedule_tick()
    {:noreply, state}
  end

  def handle_info(_msg, state), do: {:noreply, state}

  defp schedule_tick do
    Process.send_after(self(), :tick, @tick_interval)
  end

  def process_retries do
    process_retries_for(Rocket.Repo)
  end

  def process_retries_for(conn) do
    try do

      case Postgres.query_rows(conn,
             """
             SELECT id, webhook_id, entity, hook, url, method, request_headers, request_body,
                    status, attempt, max_attempts, idempotency_key
             FROM _webhook_logs
             WHERE status = 'retrying' AND next_retry_at < NOW()
             ORDER BY next_retry_at ASC
             LIMIT 50
             """) do
        {:ok, rows} ->
          Enum.each(rows, &retry_delivery(conn, &1))

        {:error, err} ->
          Logger.error("Webhook scheduler query error: #{inspect(err)}")
      end
    rescue
      e ->
        Logger.error("Webhook scheduler error: #{inspect(e)}")
    end
  end

  defp retry_delivery(conn, row) do
    attempt = (to_int(row["attempt"]) || 1) + 1
    max_attempts = to_int(row["max_attempts"]) || 1

    url = row["url"]
    method = row["method"] || "POST"

    headers = parse_json_or_map(row["request_headers"])
    body_json = if is_binary(row["request_body"]), do: row["request_body"], else: Jason.encode!(row["request_body"] || %{})

    resolved = WebhookEngine.resolve_headers(headers)
    result = WebhookEngine.dispatch_webhook(url, method, resolved, body_json)

    new_status =
      cond do
        result.error == nil && result.status_code >= 200 && result.status_code < 300 ->
          "delivered"

        attempt >= max_attempts ->
          "failed"

        true ->
          "retrying"
      end

    next_retry =
      if new_status == "retrying" do
        backoff = :math.pow(2, attempt) * 30
        DateTime.utc_now() |> DateTime.add(trunc(backoff), :second)
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
      UPDATE _webhook_logs
      SET status = $1, attempt = $2, response_status = $3, response_body = $4,
          error = $5, next_retry_at = $6, updated_at = NOW()
      WHERE id = $7
      """,
      [new_status, attempt, result.status_code, result.response_body,
       error_msg, next_retry, row["id"]])

    case new_status do
      "delivered" ->
        Logger.info("Webhook retry delivered: log=#{row["id"]} attempt=#{attempt}")

      "failed" ->
        Logger.info("Webhook retry exhausted: log=#{row["id"]} attempt=#{attempt}/#{max_attempts}")

      _ ->
        :ok
    end
  end

  defp parse_json_or_map(val) when is_map(val), do: val

  defp parse_json_or_map(val) when is_binary(val) do
    case Jason.decode(val) do
      {:ok, map} when is_map(map) -> map
      _ -> %{}
    end
  end

  defp parse_json_or_map(_), do: %{}

  defp to_int(val) when is_integer(val), do: val

  defp to_int(val) when is_binary(val) do
    case Integer.parse(val) do
      {n, _} -> n
      :error -> nil
    end
  end

  defp to_int(_), do: nil
end
