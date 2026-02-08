defmodule RocketWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :rocket

  plug Plug.RequestId
  plug Plug.Telemetry, event_prefix: [:phoenix, :endpoint]

  plug Plug.Parsers,
    parsers: [:urlencoded, :multipart, :json],
    pass: ["*/*"],
    json_decoder: Phoenix.json_library()

  plug RocketWeb.Router
end
