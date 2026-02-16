defmodule Rocket.Engine.AppError do
  @moduledoc "Structured error type for API error responses."

  defexception [:code, :status, :message, :details]

  @impl true
  def message(%__MODULE__{message: msg}), do: msg

  def new(code, status, msg, details \\ []) do
    %__MODULE__{code: code, status: status, message: msg, details: details}
  end

  def not_found(entity, id) do
    new("NOT_FOUND", 404, "#{entity} with id #{id} not found")
  end

  def unknown_entity(name) do
    new("UNKNOWN_ENTITY", 404, "Unknown entity: #{name}")
  end

  def conflict(msg) do
    new("CONFLICT", 409, msg)
  end

  def validation_failed(details) do
    new("VALIDATION_FAILED", 422, "Validation failed", details)
  end

  def unauthorized(msg) do
    new("UNAUTHORIZED", 401, msg)
  end

  def forbidden(msg) do
    new("FORBIDDEN", 403, msg)
  end

  def invalid_payload(msg) do
    new("INVALID_PAYLOAD", 400, msg)
  end

  def unknown_field(msg) do
    new("UNKNOWN_FIELD", 400, msg)
  end

  def to_json(%__MODULE__{} = err) do
    base = %{"code" => err.code, "message" => err.message}

    if err.details != nil and err.details != [] do
      Map.put(base, "details", Enum.map(err.details, &detail_to_json/1))
    else
      base
    end
  end

  defp detail_to_json(%{} = d) do
    d
    |> Enum.reject(fn {_k, v} -> v == nil end)
    |> Map.new()
  end

  defp detail_to_json(d), do: d
end
