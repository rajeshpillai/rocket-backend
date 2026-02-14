defmodule Rocket.Engine.NestedWrite do
  @moduledoc "Plan-then-execute transactional write pipeline."

  alias Rocket.Store.Postgres
  alias Rocket.Metadata.{Entity, Registry}
  alias Rocket.Engine.{Writer, AppError, Diff}
  alias Rocket.Instrument.Instrumenter

  @uuid_regex ~r/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

  defmodule WritePlan do
    defstruct [:entity, :fields, :id, :user, is_create: true, child_ops: []]
  end

  @doc "Build a WritePlan from request body. Returns {:ok, plan} or {:error, app_error}."
  def plan_write(entity, registry, body, existing_id) do
    {fields, rel_writes, unknown_keys} =
      Writer.separate_fields_and_relations(entity, registry, body)

    if unknown_keys != [] do
      errs =
        Enum.map(unknown_keys, fn key ->
          %{field: key, rule: "unknown", message: "Unknown field or relation: #{key}"}
        end)

      {:error, AppError.validation_failed(errs)}
    else
      is_create = existing_id == nil
      validation_errs = Writer.validate_fields(entity, fields, is_create)

      if validation_errs != [] do
        {:error, AppError.validation_failed(validation_errs)}
      else
        plan = %WritePlan{
          is_create: is_create,
          entity: entity,
          fields: fields,
          id: existing_id,
          child_ops: Map.values(rel_writes)
        }

        {:ok, plan}
      end
    end
  end

  @doc "Execute the write plan inside a single transaction. Returns {:ok, record} or {:error, reason}."
  def execute_write_plan(conn, registry, plan) do
    span = Instrumenter.start_span("engine", "writer", "write.execute_plan")
    span = Instrumenter.set_entity(span, plan.entity.name)

    try do
      result = do_execute_write_plan(conn, registry, plan)

      _span = case result do
        {:ok, _, _} -> Instrumenter.set_status(span, "ok")
        {:error, _} -> Instrumenter.set_status(span, "error")
        _ -> span
      end

      result
    catch
      kind, err ->
        _span = Instrumenter.set_status(span, "error")
        :erlang.raise(kind, err, __STACKTRACE__)
    after
      Instrumenter.end_span(span)
    end
  end

  defp do_execute_write_plan(conn, registry, plan) do
    # We need a raw Postgrex transaction
    execute_in_transaction(conn, fn tx_conn ->
      # Fetch old record for update
      old =
        if !plan.is_create do
          case fetch_record(tx_conn, plan.entity, plan.id) do
            {:ok, row} -> row
            _ -> %{}
          end
        else
          %{}
        end

      # Evaluate rules (stubbed for Phase 0, implemented in Phase 1)
      with :ok <- evaluate_rules_if_available(registry, plan, old),
           :ok <- evaluate_state_machines_if_available(registry, plan, old),
           :ok <- resolve_file_fields(tx_conn, plan.entity, plan.fields) do
        # Execute parent write
        parent_id =
          if plan.is_create do
            {sql, params} = Writer.build_insert_sql(plan.entity, plan.fields)

            case Postgres.query_row(tx_conn, sql, params) do
              {:ok, row} -> row[plan.entity.primary_key.field]
              {:error, err} -> throw({:write_error, err})
            end
          else
            {sql, params} = Writer.build_update_sql(plan.entity, plan.id, plan.fields)

            if sql != "" do
              case Postgres.exec(tx_conn, sql, params) do
                {:ok, _} -> :ok
                {:error, err} -> throw({:write_error, err})
              end
            end

            plan.id
          end

        # Execute child writes
        Enum.each(plan.child_ops, fn child_op ->
          case Diff.execute_child_write(tx_conn, registry, parent_id, child_op) do
            :ok -> :ok
            {:error, err} -> throw({:write_error, err})
          end
        end)

        # Fire sync webhooks (stubbed for Phase 0, implemented in Phase 5)
        fire_sync_webhooks_if_available(tx_conn, registry, plan, old)

        {parent_id, old}
      else
        {:error, %AppError{} = err} -> throw({:app_error, err})
        {:error, err} -> throw({:write_error, err})
      end
    end)
  end

  defp execute_in_transaction(conn, fun) when is_atom(conn) do
    # Ecto.Repo
    conn.transaction(fn ->
      case Ecto.Adapters.SQL.query(conn, "SELECT 1", []) do
        {:ok, _} -> :ok
        _ -> :ok
      end

      fun.(conn)
    end)
    |> handle_tx_result(conn)
  rescue
    e -> {:error, e}
  catch
    {:app_error, err} -> {:error, err}
    {:write_error, {:unique_violation, _}} ->
      {:error, AppError.conflict("A record with this value already exists")}
    {:write_error, err} -> {:error, err}
  end

  defp execute_in_transaction(conn, fun) when is_pid(conn) do
    Postgrex.transaction(conn, fn tx_conn ->
      fun.(tx_conn)
    end)
    |> handle_tx_result(conn)
  rescue
    e -> {:error, e}
  catch
    {:app_error, err} -> {:error, err}
    {:write_error, {:unique_violation, _}} ->
      {:error, AppError.conflict("A record with this value already exists")}
    {:write_error, err} -> {:error, err}
  end

  defp handle_tx_result({:ok, {parent_id, old}}, _conn) do
    {:ok, parent_id, old}
  end

  defp handle_tx_result({:ok, parent_id}, _conn) do
    {:ok, parent_id, %{}}
  end

  defp handle_tx_result({:error, :rollback}, _conn) do
    {:error, AppError.new("INTERNAL_ERROR", 500, "Transaction rolled back")}
  end

  defp handle_tx_result({:error, err}, _conn), do: {:error, err}

  @doc "Execute write plan and return the full record."
  def execute_and_fetch(conn, registry, plan) do
    case execute_write_plan(conn, registry, plan) do
      {:ok, parent_id, old} ->
        # Fetch outside transaction
        case fetch_record(conn, plan.entity, parent_id) do
          {:ok, record} ->
            # Post-commit: trigger workflows for state transitions
            trigger_workflows_if_available(conn, registry, plan, old, record, parent_id)
            # Post-commit: fire async webhooks
            fire_async_webhooks_if_available(conn, registry, plan, old, record)
            {:ok, record}

          err ->
            err
        end

      {:error, _} = err ->
        err
    end
  end

  @doc "Fetch a single record by ID."
  def fetch_record(conn, entity, id) do
    columns = Entity.field_names(entity)

    columns =
      if entity.soft_delete && !Entity.has_field?(entity, "deleted_at") do
        columns ++ ["deleted_at"]
      else
        columns
      end

    sql = "SELECT #{Enum.join(columns, ", ")} FROM #{entity.table} WHERE #{entity.primary_key.field} = $1"
    sql = if entity.soft_delete, do: sql <> " AND deleted_at IS NULL", else: sql

    Postgres.query_row(conn, sql, [id])
  end

  # Stubs for phases not yet implemented — they succeed silently
  defp evaluate_rules_if_available(registry, plan, old) do
    if Code.ensure_loaded?(Rocket.Engine.Rules) &&
         function_exported?(Rocket.Engine.Rules, :evaluate_rules, 6) do
      action = if plan.is_create, do: "create", else: "update"

      case Rocket.Engine.Rules.evaluate_rules(
             registry,
             plan.entity.name,
             "before_write",
             plan.fields,
             old,
             action
           ) do
        [] -> :ok
        errs -> {:error, AppError.validation_failed(errs)}
      end
    else
      :ok
    end
  end

  defp evaluate_state_machines_if_available(registry, plan, old) do
    if Code.ensure_loaded?(Rocket.Engine.StateMachineEngine) &&
         function_exported?(Rocket.Engine.StateMachineEngine, :evaluate_state_machines, 5) do
      case Rocket.Engine.StateMachineEngine.evaluate_state_machines(
             registry,
             plan.entity.name,
             plan.fields,
             old,
             plan.is_create
           ) do
        [] -> :ok
        errs -> {:error, AppError.validation_failed(errs)}
      end
    else
      :ok
    end
  end

  defp fire_sync_webhooks_if_available(conn, registry, plan, old) do
    if Code.ensure_loaded?(Rocket.Engine.WebhookEngine) &&
         function_exported?(Rocket.Engine.WebhookEngine, :fire_sync_webhooks, 8) do
      action = if plan.is_create, do: "create", else: "update"
      hook = if plan.is_create, do: "before_write", else: "before_write"

      case Rocket.Engine.WebhookEngine.fire_sync_webhooks(
             conn, registry, hook, plan.entity.name, action, plan.fields, old, nil
           ) do
        :ok -> :ok
        {:error, err} -> throw({:write_error, err})
      end
    else
      :ok
    end
  end

  defp trigger_workflows_if_available(conn, registry, plan, old, record, parent_id) do
    if Code.ensure_loaded?(Rocket.Engine.WorkflowEngine) &&
         function_exported?(Rocket.Engine.WorkflowEngine, :trigger_workflows, 7) do
      sms = Registry.get_state_machines_for_entity(registry, plan.entity.name)

      Enum.each(sms, fn sm ->
        old_state = if is_map(old), do: Map.get(old, sm.field, ""), else: ""
        old_state = old_state || ""
        new_state = Map.get(plan.fields, sm.field, "")
        new_state = new_state || ""

        if new_state != "" && old_state != new_state do
          Rocket.Engine.WorkflowEngine.trigger_workflows(
            conn, registry, plan.entity.name, sm.field, new_state, record, parent_id
          )
        end
      end)
    end
  rescue
    e ->
      require Logger
      Logger.error("Workflow trigger error: #{inspect(e)}")
  end

  defp fire_async_webhooks_if_available(conn, registry, plan, old, record) do
    if Code.ensure_loaded?(Rocket.Engine.WebhookEngine) &&
         function_exported?(Rocket.Engine.WebhookEngine, :fire_async_webhooks, 8) do
      action = if plan.is_create, do: "create", else: "update"

      Rocket.Engine.WebhookEngine.fire_async_webhooks(
        conn, registry, "after_write", plan.entity.name, action, record, old, nil
      )
    end
  rescue
    e ->
      require Logger
      Logger.error("Async webhook error: #{inspect(e)}")
  end

  defp resolve_file_fields(conn, entity, fields) do
    file_fields = Enum.filter(entity.fields, &(&1.type == "file"))

    Enum.reduce_while(file_fields, :ok, fn f, :ok ->
      val = Map.get(fields, f.name)

      cond do
        val == nil ->
          {:cont, :ok}

        is_map(val) ->
          {:cont, :ok}

        is_binary(val) && Regex.match?(@uuid_regex, val) ->
          case Postgres.query_row(
                 conn,
                 "SELECT id, filename, size, mime_type FROM _files WHERE id = $1",
                 [val]
               ) do
            {:ok, row} ->
              Map.put(fields, f.name, %{
                "id" => row["id"],
                "filename" => row["filename"],
                "size" => row["size"],
                "mime_type" => row["mime_type"]
              })

              {:cont, :ok}

            {:error, :not_found} ->
              {:halt, {:error, AppError.not_found("File", val)}}

            {:error, err} ->
              {:halt, {:error, err}}
          end

        true ->
          {:cont, :ok}
      end
    end)
  end
end
