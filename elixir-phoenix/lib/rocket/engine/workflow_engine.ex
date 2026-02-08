defmodule Rocket.Engine.WorkflowEngine do
  @moduledoc "Workflow execution engine: trigger, step execution, approval resolution."

  alias Rocket.Store.Postgres
  alias Rocket.Metadata.Registry
  alias Rocket.Engine.Expression

  require Logger

  # ── Trigger ──

  def trigger_workflows(conn, registry, entity, field, to_state, record, record_id) do
    workflows = Registry.get_workflows_for_trigger(registry, entity, field, to_state)

    Enum.each(workflows, fn wf ->
      case create_workflow_instance(conn, registry, wf, record, record_id) do
        {:ok, _} -> :ok
        {:error, err} -> Logger.error("Failed to start workflow #{wf.name}: #{inspect(err)}")
      end
    end)
  end

  defp create_workflow_instance(conn, registry, wf, record, record_id) do
    context = build_workflow_context(wf.context, record, record_id)

    if wf.steps == [] do
      {:error, "workflow has no steps"}
    else
      first_step = hd(wf.steps)
      first_step_id = if is_map(first_step), do: first_step.id || Map.get(first_step, "id"), else: nil

      case Postgres.query_row(conn,
             "INSERT INTO _workflow_instances (workflow_id, workflow_name, status, current_step, context, history) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
             [wf.id, wf.name, "running", first_step_id, context, []]) do
        {:ok, %{"id" => instance_id}} ->
          instance = %{
            id: instance_id,
            workflow_id: wf.id,
            workflow_name: wf.name,
            status: "running",
            current_step: first_step_id,
            current_step_deadline: nil,
            context: context,
            history: []
          }

          advance_workflow(conn, registry, wf, instance)
          {:ok, instance_id}

        {:error, err} ->
          {:error, err}
      end
    end
  end

  # ── Advance ──

  defp advance_workflow(conn, registry, wf, instance) do
    if instance.status != "running" do
      :ok
    else
      step = find_step(wf, instance.current_step)

      if step == nil do
        instance = %{instance | status: "failed"}
        persist_instance(conn, instance)
      else
        case execute_step(conn, registry, wf, instance, step) do
          {:paused, instance} ->
            persist_instance(conn, instance)

          {:next, next_goto, instance} ->
            if next_goto == nil || next_goto == "" || next_goto == "end" do
              instance = %{instance | status: "completed", current_step: nil}
              persist_instance(conn, instance)
            else
              instance = %{instance | current_step: next_goto}
              advance_workflow(conn, registry, wf, instance)
            end

          {:error, _err, instance} ->
            instance = %{instance | status: "failed"}
            persist_instance(conn, instance)
        end
      end
    end
  end

  defp execute_step(conn, registry, _wf, instance, step) do
    step_type = step_field(step, :type)

    case step_type do
      "action" -> execute_action_step(conn, registry, instance, step)
      "condition" -> execute_condition_step(instance, step)
      "approval" -> execute_approval_step(instance, step)
      _ -> {:error, "unknown step type: #{step_type}", instance}
    end
  end

  defp execute_action_step(conn, registry, instance, step) do
    actions = step_field(step, :actions) || []

    result =
      Enum.reduce_while(actions, :ok, fn action, :ok ->
        case execute_workflow_action(conn, registry, instance, action) do
          :ok -> {:cont, :ok}
          {:error, err} -> {:halt, {:error, err}}
        end
      end)

    case result do
      :ok ->
        entry = %{"step" => step_field(step, :id), "status" => "completed", "at" => now_iso()}
        instance = %{instance | history: instance.history ++ [entry]}
        next = step_field(step, :next)
        {:next, next, instance}

      {:error, err} ->
        entry = %{"step" => step_field(step, :id), "status" => "failed", "error" => inspect(err), "at" => now_iso()}
        instance = %{instance | history: instance.history ++ [entry]}
        {:error, err, instance}
    end
  end

  defp execute_condition_step(instance, step) do
    expression = step_field(step, :condition)

    if !expression || expression == "" do
      next = step_field(step, :on_true)
      entry = %{"step" => step_field(step, :id), "status" => "on_true", "at" => now_iso()}
      {:next, next, %{instance | history: instance.history ++ [entry]}}
    else
      env = %{"context" => instance.context}

      case Expression.evaluate_bool(expression, env) do
        {:ok, true} ->
          next = step_field(step, :on_true)
          entry = %{"step" => step_field(step, :id), "status" => "on_true", "at" => now_iso()}
          {:next, next, %{instance | history: instance.history ++ [entry]}}

        {:ok, false} ->
          next = step_field(step, :on_false)
          entry = %{"step" => step_field(step, :id), "status" => "on_false", "at" => now_iso()}
          {:next, next, %{instance | history: instance.history ++ [entry]}}

        {:error, err} ->
          {:error, "condition error: #{err}", instance}
      end
    end
  end

  defp execute_approval_step(instance, step) do
    deadline = step_field(step, :deadline)

    instance =
      if deadline && deadline != "" do
        seconds = parse_duration(deadline)

        if seconds > 0 do
          dt = DateTime.utc_now() |> DateTime.add(seconds, :second)
          %{instance | current_step_deadline: dt}
        else
          instance
        end
      else
        instance
      end

    {:paused, instance}
  end

  # ── Approval Resolution ──

  def resolve_workflow_action(conn, registry, instance_id, action, user_id) do
    case load_workflow_instance(conn, instance_id) do
      {:ok, instance} ->
        if instance.status != "running" do
          {:error, "workflow instance is not running (status: #{instance.status})"}
        else
          wf = Registry.get_workflow(registry, instance.workflow_name)

          if wf == nil do
            {:error, "workflow definition not found: #{instance.workflow_name}"}
          else
            step = find_step(wf, instance.current_step)

            if step == nil || step_field(step, :type) != "approval" do
              {:error, "current step is not an approval step"}
            else
              entry = %{
                "step" => step_field(step, :id),
                "status" => action,
                "by" => user_id,
                "at" => now_iso()
              }

              instance = %{instance | history: instance.history ++ [entry], current_step_deadline: nil}

              next =
                case action do
                  "approved" -> step_field(step, :on_approve)
                  "rejected" -> step_field(step, :on_reject)
                  _ -> "end"
                end

              if next == nil || next == "" || next == "end" do
                instance = %{instance | status: "completed", current_step: nil}
                persist_instance(conn, instance)
                {:ok, instance}
              else
                instance = %{instance | current_step: next}
                advance_workflow(conn, registry, wf, instance)
                load_workflow_instance(conn, instance_id)
              end
            end
          end
        end

      {:error, _} = err ->
        err
    end
  end

  # ── Query helpers ──

  def list_pending_instances(conn) do
    Postgres.query_rows(conn,
      "SELECT id, workflow_id, workflow_name, status, current_step, current_step_deadline, context, history, created_at, updated_at FROM _workflow_instances WHERE status = 'running' AND current_step IS NOT NULL ORDER BY created_at DESC")
  end

  def load_workflow_instance(conn, id) do
    case Postgres.query_row(conn,
           "SELECT id, workflow_id, workflow_name, status, current_step, current_step_deadline, context, history, created_at, updated_at FROM _workflow_instances WHERE id = $1",
           [id]) do
      {:ok, row} ->
        {:ok, %{
          id: row["id"],
          workflow_id: row["workflow_id"],
          workflow_name: row["workflow_name"],
          status: row["status"],
          current_step: row["current_step"],
          current_step_deadline: row["current_step_deadline"],
          context: row["context"] || %{},
          history: row["history"] || [],
          created_at: row["created_at"],
          updated_at: row["updated_at"]
        }}

      {:error, :not_found} ->
        {:error, "workflow instance not found: #{id}"}

      {:error, err} ->
        {:error, err}
    end
  end

  # ── Timeout processing (called by scheduler) ──

  def process_timeouts(conn, registry) do
    case Postgres.query_rows(conn,
           "SELECT id, workflow_id, workflow_name, status, current_step, current_step_deadline, context, history, created_at, updated_at FROM _workflow_instances WHERE status = 'running' AND current_step_deadline IS NOT NULL AND current_step_deadline < NOW()") do
      {:ok, rows} ->
        Enum.each(rows, fn row ->
          instance = %{
            id: row["id"],
            workflow_id: row["workflow_id"],
            workflow_name: row["workflow_name"],
            status: row["status"],
            current_step: row["current_step"],
            current_step_deadline: row["current_step_deadline"],
            context: row["context"] || %{},
            history: row["history"] || []
          }

          wf = Registry.get_workflow(registry, instance.workflow_name)

          if wf do
            step = find_step(wf, instance.current_step)

            if step do
              on_timeout = step_field(step, :on_timeout)

              entry = %{"step" => step_field(step, :id), "status" => "timed_out", "at" => now_iso()}
              instance = %{instance | history: instance.history ++ [entry], current_step_deadline: nil}

              cond do
                on_timeout && on_timeout != "" && on_timeout != "end" ->
                  advance_workflow(conn, registry, wf, %{instance | current_step: on_timeout})

                on_timeout == "end" ->
                  persist_instance(conn, %{instance | status: "completed", current_step: nil})

                true ->
                  persist_instance(conn, %{instance | status: "failed"})
              end
            end
          end
        end)

      {:error, err} ->
        Logger.error("Failed to process workflow timeouts: #{inspect(err)}")
    end
  end

  # ── Private helpers ──

  defp persist_instance(conn, instance) do
    Postgres.exec(conn,
      "UPDATE _workflow_instances SET status = $1, current_step = $2, current_step_deadline = $3, context = $4, history = $5, updated_at = NOW() WHERE id = $6",
      [instance.status, instance.current_step, instance.current_step_deadline, instance.context, instance.history, instance.id])
  end

  defp find_step(wf, step_id) do
    Enum.find(wf.steps, fn s ->
      sid = if is_map(s), do: s.id || Map.get(s, "id"), else: nil
      sid == step_id
    end)
  end

  defp step_field(step, field) when is_struct(step), do: Map.get(step, field)
  defp step_field(step, field) when is_map(step), do: Map.get(step, to_string(field))
  defp step_field(_, _), do: nil

  defp execute_workflow_action(conn, registry, instance, action) when is_map(action) do
    type = action["type"] || (if is_struct(action), do: action.type, else: nil)

    case type do
      "set_field" ->
        entity_name = action["entity"]
        field = action["field"]
        value = action["value"]
        record_id = resolve_context_path(instance.context, action["record_id"] || "record_id")

        value = if value == "now", do: DateTime.utc_now(), else: value

        if entity_name && field && record_id do
          entity = Registry.get_entity(registry, entity_name)

          if entity do
            Postgres.exec(conn,
              "UPDATE #{entity.table} SET #{field} = $1 WHERE #{entity.primary_key.field} = $2",
              [value, record_id])

            :ok
          else
            {:error, "entity not found: #{entity_name}"}
          end
        else
          :ok
        end

      "webhook" ->
        url = action["url"]
        method = action["method"] || "POST"

        if url do
          body = Jason.encode!(instance.context)
          headers = if is_map(action["headers"]), do: action["headers"], else: %{}

          result = Rocket.Engine.WebhookEngine.dispatch_webhook_direct(url, method, headers, body)

          if result.error == nil && result.status_code >= 200 && result.status_code < 300 do
            :ok
          else
            {:error, "webhook returned #{result.status_code}: #{result.error || result.response_body}"}
          end
        else
          :ok
        end

      _ ->
        Logger.info("STUB: workflow action '#{type}'")
        :ok
    end
  end

  defp execute_workflow_action(_, _, _, _), do: :ok

  defp build_workflow_context(mappings, record, record_id) when is_map(mappings) do
    envelope = %{"trigger" => %{"record_id" => record_id, "record" => record}}

    Map.new(mappings, fn {key, path} ->
      value = resolve_context_path(envelope, path)
      {key, value}
    end)
  end

  defp build_workflow_context(_, record, record_id) do
    %{"record_id" => record_id, "record" => record}
  end

  defp resolve_context_path(data, path) when is_binary(path) do
    parts = String.split(path, ".")

    Enum.reduce(parts, data, fn part, acc ->
      cond do
        is_map(acc) -> Map.get(acc, part)
        true -> nil
      end
    end)
  end

  defp resolve_context_path(_, _), do: nil

  defp parse_duration(str) when is_binary(str) do
    cond do
      String.ends_with?(str, "h") ->
        case Integer.parse(String.trim_trailing(str, "h")) do
          {n, ""} -> n * 3600
          _ -> 0
        end

      String.ends_with?(str, "m") ->
        case Integer.parse(String.trim_trailing(str, "m")) do
          {n, ""} -> n * 60
          _ -> 0
        end

      String.ends_with?(str, "s") ->
        case Integer.parse(String.trim_trailing(str, "s")) do
          {n, ""} -> n
          _ -> 0
        end

      true ->
        0
    end
  end

  defp parse_duration(_), do: 0

  defp now_iso, do: DateTime.utc_now() |> DateTime.to_iso8601()
end
