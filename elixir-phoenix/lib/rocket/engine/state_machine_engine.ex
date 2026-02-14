defmodule Rocket.Engine.StateMachineEngine do
  @moduledoc "State machine transition validation and action execution."

  alias Rocket.Metadata.Registry
  alias Rocket.Engine.Expression
  alias Rocket.Instrument.Instrumenter

  require Logger

  @doc "Evaluate all state machines for an entity. Returns [] on success or [%{field, rule, message}]."
  def evaluate_state_machines(registry, entity_name, fields, old, is_create) do
    span = Instrumenter.start_span("engine", "state_machine", "transition.evaluate")
    span = Instrumenter.set_entity(span, entity_name)

    try do
      result = do_evaluate_state_machines(registry, entity_name, fields, old, is_create)

      _span = case result do
        [] -> Instrumenter.set_status(span, "ok")
        _ -> Instrumenter.set_status(span, "error")
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

  defp do_evaluate_state_machines(registry, entity_name, fields, old, is_create) do
    machines = Registry.get_state_machines_for_entity(registry, entity_name)

    if machines == [] do
      []
    else
      Enum.flat_map(machines, fn sm ->
        case evaluate_state_machine(sm, fields, old, is_create) do
          nil -> []
          err -> [err]
        end
      end)
    end
  end

  defp evaluate_state_machine(sm, fields, old, is_create) do
    new_state = fields[sm.field]

    if new_state == nil do
      nil
    else
      new_state_str = to_string(new_state)

      if is_create do
        evaluate_create(sm, new_state_str)
      else
        evaluate_update(sm, fields, old, new_state_str)
      end
    end
  end

  defp evaluate_create(sm, new_state) do
    initial = sm.definition.initial_state

    if initial != nil && initial != "" && new_state != initial do
      %{
        field: sm.field,
        rule: "state_machine",
        message: "Initial state must be '#{initial}', got '#{new_state}'"
      }
    else
      nil
    end
  end

  defp evaluate_update(sm, fields, old, new_state) do
    old_state = to_string(old[sm.field] || "")

    if old_state == new_state do
      nil
    else
      transition = find_transition(sm, old_state, new_state)

      if transition == nil do
        %{
          field: sm.field,
          rule: "state_machine",
          message: "Invalid transition from '#{old_state}' to '#{new_state}'"
        }
      else
        # Evaluate guard if present
        case evaluate_guard(transition, fields, old) do
          {:ok, :allowed} ->
            # Execute actions
            execute_actions(transition, fields)
            nil

          {:ok, :blocked} ->
            %{
              field: sm.field,
              rule: "state_machine",
              message: "Transition from '#{old_state}' to '#{new_state}' blocked by guard"
            }

          {:error, err} ->
            %{
              field: sm.field,
              rule: "state_machine",
              message: "Guard evaluation error: #{err}"
            }
        end
      end
    end
  end

  @doc "Find a transition matching from → to."
  def find_transition(sm, old_state, new_state) do
    Enum.find(sm.definition.transitions, fn t ->
      t.to == new_state && old_state in t.from
    end)
  end

  defp evaluate_guard(transition, fields, old) do
    guard = transition.guard

    if !guard || guard == "" do
      {:ok, :allowed}
    else
      env = %{
        "record" => fields || %{},
        "old" => old || %{},
        "action" => "update"
      }

      case Expression.evaluate_bool(guard, env) do
        {:ok, true} -> {:ok, :allowed}
        {:ok, false} -> {:ok, :blocked}
        {:error, err} -> {:error, err}
      end
    end
  end

  defp execute_actions(transition, fields) do
    Enum.each(transition.actions, fn action ->
      case action.type do
        "set_field" ->
          if action.field do
            value =
              if action.value == "now" do
                DateTime.utc_now()
              else
                action.value
              end

            Map.put(fields, action.field, value)
          end

        "webhook" ->
          if action.url do
            Task.start(fn ->
              try do
                body = Jason.encode!(fields)
                headers = if is_map(action.headers), do: action.headers, else: %{}

                Rocket.Engine.WebhookEngine.dispatch_webhook_direct(
                  action.url, action.method, headers, body
                )
              rescue
                e -> Logger.warning("State machine webhook error: #{inspect(e)}")
              end
            end)
          end

        "create_record" ->
          Logger.info("STUB: create_record action for entity #{action.entity}")

        _ ->
          :ok
      end
    end)
  end
end
