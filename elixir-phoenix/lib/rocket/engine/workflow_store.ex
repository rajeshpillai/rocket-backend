defmodule Rocket.Engine.WorkflowStore do
  @moduledoc """
  Behaviour for workflow instance persistence.
  Abstracts all _workflow_instances SQL operations.
  """

  @callback create_instance(conn :: term(), data :: map()) :: {:ok, String.t()} | {:error, term()}
  @callback load_instance(conn :: term(), id :: String.t()) :: {:ok, map()} | {:error, term()}
  @callback persist_instance(conn :: term(), instance :: map()) :: :ok | {:error, term()}
  @callback list_pending(conn :: term()) :: {:ok, list(map())} | {:error, term()}
  @callback find_timed_out(conn :: term()) :: {:ok, list(map())} | {:error, term()}
end

defmodule Rocket.Engine.PostgresWorkflowStore do
  @moduledoc "Postgres implementation of WorkflowStore."
  @behaviour Rocket.Engine.WorkflowStore

  alias Rocket.Store.Postgres

  @impl true
  def create_instance(conn, data) do
    case Postgres.query_row(conn,
           "INSERT INTO _workflow_instances (workflow_id, workflow_name, status, current_step, context, history) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
           [data.workflow_id, data.workflow_name, "running", data.current_step, data.context, []]) do
      {:ok, %{"id" => id}} -> {:ok, id}
      {:error, err} -> {:error, err}
    end
  end

  @impl true
  def load_instance(conn, id) do
    case Postgres.query_row(conn,
           "SELECT id, workflow_id, workflow_name, status, current_step, current_step_deadline, context, history, created_at, updated_at FROM _workflow_instances WHERE id = $1",
           [id]) do
      {:ok, row} -> {:ok, parse_instance_row(row)}
      {:error, :not_found} -> {:error, "workflow instance not found: #{id}"}
      {:error, err} -> {:error, err}
    end
  end

  @impl true
  def persist_instance(conn, instance) do
    case Postgres.exec(conn,
           "UPDATE _workflow_instances SET status = $1, current_step = $2, current_step_deadline = $3, context = $4, history = $5, updated_at = NOW() WHERE id = $6",
           [instance.status, instance.current_step, instance.current_step_deadline, instance.context, instance.history, instance.id]) do
      {:ok, _} -> :ok
      {:error, err} -> {:error, err}
    end
  end

  @impl true
  def list_pending(conn) do
    Postgres.query_rows(conn,
      "SELECT id, workflow_id, workflow_name, status, current_step, current_step_deadline, context, history, created_at, updated_at FROM _workflow_instances WHERE status = 'running' AND current_step IS NOT NULL ORDER BY created_at DESC")
  end

  @impl true
  def find_timed_out(conn) do
    Postgres.query_rows(conn,
      "SELECT id, workflow_id, workflow_name, status, current_step, current_step_deadline, context, history, created_at, updated_at FROM _workflow_instances WHERE status = 'running' AND current_step_deadline IS NOT NULL AND current_step_deadline < NOW()")
  end

  defp parse_instance_row(row) do
    %{
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
    }
  end
end
