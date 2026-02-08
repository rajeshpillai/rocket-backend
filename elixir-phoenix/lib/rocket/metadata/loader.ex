defmodule Rocket.Metadata.Loader do
  @moduledoc "Loads all metadata from database into Registry."

  alias Rocket.Store.Postgres
  alias Rocket.Metadata.{Registry, Entity, Relation}

  require Logger

  def load_all(conn, registry) do
    with {:ok, entities} <- load_entities(conn),
         {:ok, relations} <- load_relations(conn) do
      Registry.load(registry, entities, relations)

      {:ok, rules} = load_rules(conn)
      Registry.load_rules(registry, rules)

      {:ok, machines} = load_state_machines(conn)
      Registry.load_state_machines(registry, machines)

      {:ok, workflows} = load_workflows(conn)
      Registry.load_workflows(registry, workflows)

      {:ok, permissions} = load_permissions(conn)
      Registry.load_permissions(registry, permissions)

      {:ok, webhooks} = load_webhooks(conn)
      Registry.load_webhooks(registry, webhooks)

      Logger.info(
        "Loaded #{length(entities)} entities, #{length(relations)} relations, " <>
          "#{length(rules)} rules, #{length(machines)} state machines, " <>
          "#{length(workflows)} workflows, #{length(permissions)} permissions, " <>
          "#{length(webhooks)} webhooks into registry"
      )

      :ok
    end
  end

  def reload(conn, registry), do: load_all(conn, registry)

  # ── Individual loaders ──

  defp load_entities(conn) do
    case Postgres.query_rows(conn, "SELECT name, table_name, definition FROM _entities ORDER BY name") do
      {:ok, rows} ->
        entities =
          rows
          |> Enum.map(fn r ->
            case r["definition"] do
              def_map when is_map(def_map) ->
                merged = Map.merge(def_map, %{"name" => r["name"], "table" => r["table_name"] || r["name"]})
                Entity.from_map(merged)

              _ ->
                nil
            end
          end)
          |> Enum.reject(&is_nil/1)

        {:ok, entities}

      {:error, err} ->
        {:error, err}
    end
  end

  defp load_relations(conn) do
    case Postgres.query_rows(conn, "SELECT name, source, target, definition FROM _relations ORDER BY name") do
      {:ok, rows} ->
        relations =
          rows
          |> Enum.map(fn r ->
            case r["definition"] do
              def_map when is_map(def_map) ->
                merged = Map.merge(def_map, %{"name" => r["name"], "source" => r["source"], "target" => r["target"]})
                Relation.from_map(merged)

              _ ->
                nil
            end
          end)
          |> Enum.reject(&is_nil/1)

        {:ok, relations}

      {:error, err} ->
        {:error, err}
    end
  end

  defp load_rules(conn) do
    case Postgres.query_rows(
           conn,
           "SELECT id, entity, hook, type, definition, priority, active FROM _rules ORDER BY entity, priority"
         ) do
      {:ok, rows} ->
        rules =
          Enum.map(rows, fn r ->
            %Rocket.Metadata.Rule{
              id: r["id"],
              entity: r["entity"],
              hook: r["hook"],
              type: r["type"],
              definition: parse_rule_definition(r["definition"]),
              priority: r["priority"] || 0,
              active: r["active"] != false
            }
          end)

        {:ok, rules}

      {:error, err} ->
        {:error, err}
    end
  end

  defp load_state_machines(conn) do
    case Postgres.query_rows(
           conn,
           "SELECT id, entity, field, definition, active FROM _state_machines ORDER BY entity"
         ) do
      {:ok, rows} ->
        machines =
          Enum.map(rows, fn r ->
            %Rocket.Metadata.StateMachine{
              id: r["id"],
              entity: r["entity"],
              field: r["field"],
              definition: parse_state_machine_definition(r["definition"]),
              active: r["active"] != false
            }
          end)

        {:ok, machines}

      {:error, err} ->
        {:error, err}
    end
  end

  defp load_workflows(conn) do
    case Postgres.query_rows(
           conn,
           "SELECT id, name, trigger, context, steps, active FROM _workflows ORDER BY name"
         ) do
      {:ok, rows} ->
        workflows =
          Enum.map(rows, fn r ->
            %Rocket.Metadata.Workflow{
              id: r["id"],
              name: r["name"],
              trigger: parse_workflow_trigger(r["trigger"]),
              context: r["context"] || %{},
              steps: parse_workflow_steps(r["steps"]),
              active: r["active"] != false
            }
          end)

        {:ok, workflows}

      {:error, err} ->
        {:error, err}
    end
  end

  defp load_permissions(conn) do
    case Postgres.query_rows(
           conn,
           "SELECT id, entity, action, roles, conditions FROM _permissions ORDER BY entity, action"
         ) do
      {:ok, rows} ->
        permissions =
          Enum.map(rows, fn r ->
            %Rocket.Metadata.Permission{
              id: r["id"],
              entity: r["entity"],
              action: r["action"],
              roles: r["roles"] || [],
              conditions: parse_permission_conditions(r["conditions"])
            }
          end)

        {:ok, permissions}

      {:error, err} ->
        {:error, err}
    end
  end

  defp load_webhooks(conn) do
    case Postgres.query_rows(
           conn,
           "SELECT id, entity, hook, url, method, headers, condition, async, retry, active FROM _webhooks ORDER BY entity, hook"
         ) do
      {:ok, rows} ->
        webhooks =
          Enum.map(rows, fn r ->
            %Rocket.Metadata.Webhook{
              id: r["id"],
              entity: r["entity"],
              hook: r["hook"],
              url: r["url"],
              method: r["method"] || "POST",
              headers: r["headers"] || %{},
              condition: r["condition"] || "",
              async: r["async"] != false,
              retry: parse_webhook_retry(r["retry"]),
              active: r["active"] != false
            }
          end)

        {:ok, webhooks}

      {:error, err} ->
        {:error, err}
    end
  end

  # ── Parsers ──

  defp parse_rule_definition(nil), do: %Rocket.Metadata.RuleDefinition{}

  defp parse_rule_definition(map) when is_map(map) do
    %Rocket.Metadata.RuleDefinition{
      field: map["field"],
      operator: map["operator"],
      value: map["value"],
      expression: map["expression"],
      message: map["message"],
      stop_on_fail: map["stop_on_fail"] || false
    }
  end

  defp parse_rule_definition(_), do: %Rocket.Metadata.RuleDefinition{}

  defp parse_state_machine_definition(nil), do: %Rocket.Metadata.StateMachineDefinition{}

  defp parse_state_machine_definition(map) when is_map(map) do
    %Rocket.Metadata.StateMachineDefinition{
      states: map["states"] || [],
      initial_state: map["initial_state"],
      transitions:
        (map["transitions"] || [])
        |> Enum.map(&parse_transition/1)
    }
  end

  defp parse_state_machine_definition(_), do: %Rocket.Metadata.StateMachineDefinition{}

  defp parse_transition(map) when is_map(map) do
    from =
      case map["from"] do
        list when is_list(list) -> list
        str when is_binary(str) -> [str]
        _ -> []
      end

    %Rocket.Metadata.Transition{
      from: from,
      to: map["to"],
      roles: map["roles"] || [],
      guard: map["guard"],
      actions: (map["actions"] || []) |> Enum.map(&parse_transition_action/1)
    }
  end

  defp parse_transition(_), do: nil

  defp parse_transition_action(map) when is_map(map) do
    %Rocket.Metadata.TransitionAction{
      type: map["type"],
      field: map["field"],
      value: map["value"],
      url: map["url"],
      method: map["method"],
      entity: map["entity"],
      data: map["data"]
    }
  end

  defp parse_transition_action(_), do: nil

  defp parse_workflow_trigger(nil), do: %Rocket.Metadata.WorkflowTrigger{}

  defp parse_workflow_trigger(map) when is_map(map) do
    %Rocket.Metadata.WorkflowTrigger{
      type: map["type"],
      entity: map["entity"],
      field: map["field"],
      to: map["to"]
    }
  end

  defp parse_workflow_trigger(_), do: %Rocket.Metadata.WorkflowTrigger{}

  defp parse_workflow_steps(nil), do: []

  defp parse_workflow_steps(list) when is_list(list) do
    Enum.map(list, &parse_workflow_step/1)
  end

  defp parse_workflow_steps(_), do: []

  defp parse_workflow_step(map) when is_map(map) do
    %Rocket.Metadata.WorkflowStep{
      id: map["id"],
      name: map["name"],
      type: map["type"],
      actions: map["actions"] || [],
      condition: map["condition"],
      on_true: parse_step_goto(map["on_true"]),
      on_false: parse_step_goto(map["on_false"]),
      on_approve: parse_step_goto(map["on_approve"]),
      on_reject: parse_step_goto(map["on_reject"]),
      on_timeout: parse_step_goto(map["on_timeout"]),
      deadline: map["deadline"],
      roles: map["roles"] || [],
      next: parse_step_goto(map["next"])
    }
  end

  defp parse_workflow_step(_), do: nil

  defp parse_step_goto(nil), do: nil
  defp parse_step_goto("end"), do: "end"
  defp parse_step_goto(%{"goto" => step_id}), do: step_id
  defp parse_step_goto(other) when is_binary(other), do: other
  defp parse_step_goto(_), do: nil

  defp parse_permission_conditions(nil), do: []

  defp parse_permission_conditions(list) when is_list(list) do
    Enum.map(list, fn c ->
      %Rocket.Metadata.PermissionCondition{
        field: c["field"],
        operator: c["operator"] || "eq",
        value: c["value"]
      }
    end)
  end

  defp parse_permission_conditions(_), do: []

  defp parse_webhook_retry(nil), do: %Rocket.Metadata.WebhookRetry{}

  defp parse_webhook_retry(map) when is_map(map) do
    %Rocket.Metadata.WebhookRetry{
      max_attempts: map["max_attempts"] || 3,
      backoff: map["backoff"] || "exponential"
    }
  end

  defp parse_webhook_retry(_), do: %Rocket.Metadata.WebhookRetry{}
end
