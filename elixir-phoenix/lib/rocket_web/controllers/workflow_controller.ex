defmodule RocketWeb.WorkflowController do
  @moduledoc "Runtime workflow endpoints: pending, get, approve, reject."
  use RocketWeb, :controller

  alias Rocket.Engine.{WorkflowEngine, AppError}
  alias Rocket.Instrument.Instrumenter

  # GET /api/_workflows/pending
  def pending(conn, _params) do
    db = get_conn(conn)

    case WorkflowEngine.list_pending_instances(db) do
      {:ok, rows} ->
        json(conn, %{data: rows})

      {:error, err} ->
        respond_error(conn, wrap_error(err))
    end
  end

  # GET /api/_workflows/:id
  def get_instance(conn, %{"id" => id}) do
    db = get_conn(conn)

    case WorkflowEngine.load_workflow_instance(db, id) do
      {:ok, instance} ->
        json(conn, %{data: instance})

      {:error, err} when is_binary(err) ->
        respond_error(conn, AppError.not_found("workflow_instance", id))

      {:error, err} ->
        respond_error(conn, wrap_error(err))
    end
  end

  # POST /api/_workflows/:id/approve
  def approve(conn, %{"id" => id}) do
    span = Instrumenter.start_span("engine", "workflow", "workflow.approve")

    try do
      db = get_conn(conn)
      registry = get_registry(conn)
      user_id = get_user_id(conn)

      case WorkflowEngine.resolve_workflow_action(db, registry, id, "approved", user_id) do
        {:ok, instance} ->
          _span = Instrumenter.set_status(span, "ok")
          json(conn, %{data: instance})

        {:error, err} when is_binary(err) ->
          _span = Instrumenter.set_status(span, "error")
          respond_error(conn, AppError.new("VALIDATION_FAILED", 422, err))

        {:error, err} ->
          _span = Instrumenter.set_status(span, "error")
          respond_error(conn, wrap_error(err))
      end
    after
      Instrumenter.end_span(span)
    end
  end

  # POST /api/_workflows/:id/reject
  def reject(conn, %{"id" => id}) do
    span = Instrumenter.start_span("engine", "workflow", "workflow.reject")

    try do
      db = get_conn(conn)
      registry = get_registry(conn)
      user_id = get_user_id(conn)

      case WorkflowEngine.resolve_workflow_action(db, registry, id, "rejected", user_id) do
        {:ok, instance} ->
          _span = Instrumenter.set_status(span, "ok")
          json(conn, %{data: instance})

        {:error, err} when is_binary(err) ->
          _span = Instrumenter.set_status(span, "error")
          respond_error(conn, AppError.new("VALIDATION_FAILED", 422, err))

        {:error, err} ->
          _span = Instrumenter.set_status(span, "error")
          respond_error(conn, wrap_error(err))
      end
    after
      Instrumenter.end_span(span)
    end
  end

  # ── Helpers ──

  defp get_registry(conn) do
    conn.assigns[:registry] || Rocket.Metadata.Registry
  end

  defp get_conn(conn) do
    conn.assigns[:db_conn] || Rocket.Store.mgmt_conn()
  end

  defp get_user_id(conn) do
    case conn.assigns[:current_user] do
      %{"id" => id} -> id
      %{id: id} -> id
      _ -> nil
    end
  end

  defp respond_error(conn, %AppError{} = err) do
    conn
    |> put_status(err.status)
    |> json(%{error: AppError.to_json(err)})
  end

  defp wrap_error(%AppError{} = err), do: err
  defp wrap_error(err), do: AppError.new("INTERNAL_ERROR", 500, "#{inspect(err)}")
end
