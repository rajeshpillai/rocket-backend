defmodule Rocket.Engine.WorkflowEngine do
  @moduledoc """
  Workflow execution engine: trigger, step advancement, approval resolution, timeout handling.
  All dependencies (store, step executors, action executors, evaluator) are injected via context.
  """

  alias Rocket.Metadata.Registry
  alias Rocket.Engine.{PostgresWorkflowStore, StepExecutors, ActionExecutors, DefaultWorkflowExpression}

  require Logger

  # ── Public API (backward-compatible signatures) ──

  def trigger_workflows(conn, registry, entity, field, to_state, record, record_id) do
    ctx = default_context(conn, registry)
    workflows = Registry.get_workflows_for_trigger(registry, entity, field, to_state)

    Enum.each(workflows, fn wf ->
      case create_instance(ctx, wf, record, record_id) do
        {:ok, _} -> :ok
        {:error, err} -> Logger.error("Failed to start workflow #{wf.name}: #{inspect(err)}")
      end
    end)
  end

  def resolve_workflow_action(conn, registry, instance_id, action, user_id) do
    ctx = default_context(conn, registry)

    case ctx.store.load_instance(conn, instance_id) do
      {:ok, instance} ->
        do_resolve_action(ctx, instance, action, user_id)

      {:error, _} = err ->
        err
    end
  end

  def process_timeouts(conn, registry) do
    ctx = default_context(conn, registry)

    case ctx.store.find_timed_out(conn) do
      {:ok, rows} ->
        instances = if is_list(rows), do: Enum.map(rows, &ensure_instance_map/1), else: []

        Enum.each(instances, fn instance ->
          handle_timeout(ctx, instance)
        end)

      {:error, err} ->
        Logger.error("Failed to process workflow timeouts: #{inspect(err)}")
    end
  end

  def list_pending_instances(conn) do
    PostgresWorkflowStore.list_pending(conn)
  end

  def load_workflow_instance(conn, id) do
    PostgresWorkflowStore.load_instance(conn, id)
  end

  # ── Internal: context building ──

  defp default_context(conn, registry) do
    %{
      conn: conn,
      registry: registry,
      store: PostgresWorkflowStore,
      step_executors: StepExecutors.default(),
      action_executors: ActionExecutors.default(),
      evaluator: DefaultWorkflowExpression
    }
  end

  # ── Internal: instance creation ──

  defp create_instance(ctx, wf, record, record_id) do
    context = build_workflow_context(wf.context, record, record_id)

    if wf.steps == [] do
      {:error, "workflow has no steps"}
    else
      first_step = hd(wf.steps)
      first_step_id = if is_map(first_step), do: first_step.id || Map.get(first_step, "id"), else: nil

      case ctx.store.create_instance(ctx.conn, %{
             workflow_id: wf.id,
             workflow_name: wf.name,
             current_step: first_step_id,
             context: context
           }) do
        {:ok, instance_id} ->
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

          advance_workflow(ctx, wf, instance)
          {:ok, instance_id}

        {:error, err} ->
          {:error, err}
      end
    end
  end

  # ── Internal: workflow advancement ──

  defp advance_workflow(ctx, wf, instance) do
    if instance.status != "running" do
      :ok
    else
      step = find_step(wf, instance.current_step)

      if step == nil do
        instance = %{instance | status: "failed"}
        ctx.store.persist_instance(ctx.conn, instance)
      else
        executor = Map.get(ctx.step_executors, step_field(step, :type))

        if executor == nil do
          instance = %{instance | status: "failed"}
          ctx.store.persist_instance(ctx.conn, instance)
        else
          step_ctx = %{
            action_executors: ctx.action_executors,
            evaluator: ctx.evaluator,
            registry: ctx.registry
          }

          case executor.execute(ctx.conn, step_ctx, instance, step) do
            {:paused, instance} ->
              ctx.store.persist_instance(ctx.conn, instance)

            {:next, next_goto, instance} ->
              if next_goto == nil || next_goto == "" || next_goto == "end" do
                instance = %{instance | status: "completed", current_step: nil}
                ctx.store.persist_instance(ctx.conn, instance)
              else
                instance = %{instance | current_step: next_goto}
                advance_workflow(ctx, wf, instance)
              end

            {:error, _err, instance} ->
              instance = %{instance | status: "failed"}
              ctx.store.persist_instance(ctx.conn, instance)
          end
        end
      end
    end
  end

  # ── Internal: approval resolution ──

  defp do_resolve_action(ctx, instance, action, user_id) do
    if instance.status != "running" do
      {:error, "workflow instance is not running (status: #{instance.status})"}
    else
      wf = Registry.get_workflow(ctx.registry, instance.workflow_name)

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
            ctx.store.persist_instance(ctx.conn, instance)
            {:ok, instance}
          else
            instance = %{instance | current_step: next}
            advance_workflow(ctx, wf, instance)
            ctx.store.load_instance(ctx.conn, instance.id)
          end
        end
      end
    end
  end

  # ── Internal: timeout handling ──

  defp handle_timeout(ctx, instance) do
    wf = Registry.get_workflow(ctx.registry, instance.workflow_name)

    if wf do
      step = find_step(wf, instance.current_step)

      if step do
        on_timeout = step_field(step, :on_timeout)

        entry = %{"step" => step_field(step, :id), "status" => "timed_out", "at" => now_iso()}
        instance = %{instance | history: instance.history ++ [entry], current_step_deadline: nil}

        cond do
          on_timeout && on_timeout != "" && on_timeout != "end" ->
            advance_workflow(ctx, wf, %{instance | current_step: on_timeout})

          on_timeout == "end" ->
            ctx.store.persist_instance(ctx.conn, %{instance | status: "completed", current_step: nil})

          true ->
            ctx.store.persist_instance(ctx.conn, %{instance | status: "failed"})
        end
      end
    end
  end

  # ── Helpers ──

  defp find_step(wf, step_id) do
    Enum.find(wf.steps, fn s ->
      sid = if is_map(s), do: s.id || Map.get(s, "id"), else: nil
      sid == step_id
    end)
  end

  defp step_field(step, field) when is_struct(step), do: Map.get(step, field)
  defp step_field(step, field) when is_map(step), do: Map.get(step, to_string(field))
  defp step_field(_, _), do: nil

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

  defp ensure_instance_map(%{id: _} = m), do: m

  defp ensure_instance_map(row) when is_map(row) do
    %{
      id: row["id"],
      workflow_id: row["workflow_id"],
      workflow_name: row["workflow_name"],
      status: row["status"],
      current_step: row["current_step"],
      current_step_deadline: row["current_step_deadline"],
      context: row["context"] || %{},
      history: row["history"] || []
    }
  end

  defp now_iso, do: DateTime.utc_now() |> DateTime.to_iso8601()
end
