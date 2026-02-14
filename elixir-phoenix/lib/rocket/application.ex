defmodule Rocket.Application do
  @moduledoc false
  use Application
  require Logger

  @impl true
  def start(_type, _args) do
    # Initialize expression AST cache (ETS table) before supervisors start
    Rocket.Engine.Expression.init_cache()

    # Load config and store instrumentation settings in Application env
    cfg = Rocket.Config.load()
    Application.put_env(:rocket, :instrumentation_config, cfg.instrumentation)

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
