defmodule Rocket.Metadata.WebhookRetry do
  defstruct max_attempts: 3, backoff: "exponential"
end

defmodule Rocket.Metadata.Webhook do
  defstruct [
    :id,
    :entity,
    :hook,
    :url,
    :condition,
    method: "POST",
    headers: %{},
    async: true,
    retry: %Rocket.Metadata.WebhookRetry{},
    active: true
  ]
end
