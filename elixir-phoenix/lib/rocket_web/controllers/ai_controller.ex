defmodule RocketWeb.AIController do
  @moduledoc "AI Schema Generator endpoints: status + generate."
  use RocketWeb, :controller

  alias Rocket.AI.{Provider, SystemPrompt}
  alias Rocket.Metadata.Registry
  alias Rocket.Engine.AppError

  @doc "GET /_admin/ai/status — returns whether AI is configured and the model name."
  def status(conn, _params) do
    provider = get_ai_provider()

    if provider do
      json(conn, %{data: %{configured: true, model: provider.model}})
    else
      json(conn, %{data: %{configured: false, model: ""}})
    end
  end

  @doc "POST /_admin/ai/generate — accepts a prompt and returns a generated schema."
  def generate(conn, params) do
    provider = get_ai_provider()

    if !provider do
      respond_error(conn, AppError.new("AI_REQUEST_FAILED", 502, "AI is not configured"))
    else
      prompt = params["prompt"]

      cond do
        !prompt || !is_binary(prompt) || prompt == "" ->
          respond_error(conn, AppError.invalid_payload("prompt is required"))

        String.length(prompt) > 5000 ->
          respond_error(conn, AppError.invalid_payload("prompt must be 5000 characters or fewer"))

        true ->
          registry = conn.assigns[:registry] || Registry

          existing_entities =
            registry
            |> Registry.all_entities()
            |> Enum.map(& &1.name)

          system_prompt = SystemPrompt.build(existing_entities)

          case Provider.generate(provider, system_prompt, prompt) do
            {:ok, raw} ->
              case Jason.decode(raw) do
                {:ok, schema} ->
                  schema = Map.put_new(schema, "version", 1)
                  json(conn, %{data: %{schema: schema}})

                {:error, _} ->
                  respond_error(conn, AppError.new("AI_REQUEST_FAILED", 502, "AI returned invalid JSON. Try rephrasing your prompt."))
              end

            {:error, %AppError{} = err} ->
              respond_error(conn, err)
          end
      end
    end
  end

  defp get_ai_provider do
    Application.get_env(:rocket, :ai_provider)
  end

  defp respond_error(conn, %AppError{} = err) do
    conn
    |> put_status(err.status)
    |> json(%{error: AppError.to_json(err)})
  end
end
