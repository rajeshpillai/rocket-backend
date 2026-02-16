defmodule Rocket.AI.Provider do
  @moduledoc "OpenAI-compatible chat completions client using Req."

  alias Rocket.Engine.AppError

  defstruct [:base_url, :api_key, :model]

  @doc "Creates a new AI provider. Returns nil if not configured."
  def new(base_url, api_key, model) do
    if base_url && base_url != "" && api_key && api_key != "" && model && model != "" do
      %__MODULE__{
        base_url: String.trim_trailing(base_url, "/"),
        api_key: api_key,
        model: model
      }
    else
      nil
    end
  end

  @doc "Sends a system + user prompt to the LLM and returns the raw response text."
  def generate(%__MODULE__{} = provider, system_prompt, user_prompt) do
    url = "#{provider.base_url}/chat/completions"

    body = %{
      "model" => provider.model,
      "temperature" => 0.3,
      "response_format" => %{"type" => "json_object"},
      "messages" => [
        %{"role" => "system", "content" => system_prompt},
        %{"role" => "user", "content" => user_prompt}
      ]
    }

    case Req.post(url,
           json: body,
           headers: [
             {"content-type", "application/json"},
             {"authorization", "Bearer #{provider.api_key}"}
           ],
           receive_timeout: 120_000
         ) do
      {:ok, %Req.Response{status: status, body: resp_body}} when status >= 200 and status < 300 ->
        content =
          case resp_body do
            %{"choices" => [%{"message" => %{"content" => c}} | _]} when is_binary(c) and c != "" -> c
            _ -> nil
          end

        if content do
          {:ok, content}
        else
          {:error, AppError.new("AI_REQUEST_FAILED", 502, "AI provider returned empty response")}
        end

      {:ok, %Req.Response{status: status, body: resp_body}} ->
        detail =
          case resp_body do
            %{"error" => %{"message" => msg}} when is_binary(msg) -> msg
            body when is_binary(body) -> body
            body -> inspect(body)
          end

        {:error, AppError.new("AI_REQUEST_FAILED", 502, "AI provider returned #{status}: #{detail}")}

      {:error, reason} ->
        {:error, AppError.new("AI_REQUEST_FAILED", 502, "Failed to connect to AI provider: #{inspect(reason)}")}
    end
  end
end
