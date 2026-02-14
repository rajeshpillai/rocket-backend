defmodule Rocket.Engine.ActionExecutor do
  @moduledoc "Behaviour for executing a single workflow action type."

  @callback execute(conn :: term(), registry :: term(), instance :: map(), action :: map()) ::
              :ok | {:error, term()}
end

defmodule Rocket.Engine.ActionExecutors.SetField do
  @moduledoc "Performs a field update on a target entity record."
  @behaviour Rocket.Engine.ActionExecutor

  alias Rocket.Store.Postgres
  alias Rocket.Metadata.Registry

  @impl true
  def execute(conn, registry, instance, action) do
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
end

defmodule Rocket.Engine.ActionExecutors.Webhook do
  @moduledoc "Dispatches an HTTP request as a workflow action."
  @behaviour Rocket.Engine.ActionExecutor

  @impl true
  def execute(_conn, _registry, instance, action) do
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
  end
end

defmodule Rocket.Engine.ActionExecutors.CreateRecord do
  @moduledoc "Creates a new record in a target entity (stub)."
  @behaviour Rocket.Engine.ActionExecutor

  require Logger

  @impl true
  def execute(_conn, _registry, _instance, action) do
    Logger.info("STUB: workflow create_record action for entity #{action["entity"]}")
    :ok
  end
end

defmodule Rocket.Engine.ActionExecutors.SendEvent do
  @moduledoc "Emits a named event (stub)."
  @behaviour Rocket.Engine.ActionExecutor

  require Logger

  @impl true
  def execute(_conn, _registry, _instance, action) do
    Logger.info("STUB: workflow send_event action '#{action["type"]}'")
    :ok
  end
end

defmodule Rocket.Engine.ActionExecutors do
  @moduledoc "Registry of default action executors."

  alias Rocket.Engine.ActionExecutors

  def default do
    %{
      "set_field" => ActionExecutors.SetField,
      "webhook" => ActionExecutors.Webhook,
      "create_record" => ActionExecutors.CreateRecord,
      "send_event" => ActionExecutors.SendEvent
    }
  end
end
