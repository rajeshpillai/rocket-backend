defmodule Rocket.Application do
  @moduledoc false
  use Application
  require Logger

  @impl true
  def start(_type, _args) do
    children = [
      RocketWeb.Telemetry,
      Rocket.Repo,
      {Phoenix.PubSub, name: Rocket.PubSub},
      Rocket.MultiApp.AppManager,
      Rocket.MultiApp.Scheduler,
      RocketWeb.Endpoint
    ]

    opts = [strategy: :one_for_one, name: Rocket.Supervisor]
    Supervisor.start_link(children, opts)
  end

  @impl true
  def config_change(changed, _new, removed) do
    RocketWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
