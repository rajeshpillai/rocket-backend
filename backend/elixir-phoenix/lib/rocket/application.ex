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

    # Initialize AI provider (if configured)
    ai_provider = Rocket.AI.Provider.new(cfg.ai.base_url, cfg.ai.api_key, cfg.ai.model)
    Application.put_env(:rocket, :ai_provider, ai_provider)

    # Set up dialect based on driver
    driver = cfg.database.driver || "postgres"
    dialect = Rocket.Store.Dialect.new(driver)
    Application.put_env(:rocket, :dialect, dialect)

    # Store db config for AppManager/AppContext to use (per-app pool size)
    app_pool_size = cfg.app_pool_size || 5

    # Include both PG and SQLite config for mixed-driver support (per-app driver)
    db_config =
      if driver == "sqlite" do
        [
          data_dir: cfg.database.data_dir || "./data",
          pool_size: app_pool_size
        ]
      else
        [
          hostname: cfg.database.host,
          port: cfg.database.port,
          username: cfg.database.user,
          password: cfg.database.password,
          database: cfg.database.name,
          data_dir: cfg.database.data_dir || "./data",
          pool_size: app_pool_size
        ]
      end

    Application.put_env(:rocket, :db_config, db_config)

    # Build children based on driver
    children =
      if driver == "sqlite" do
        # SQLite mode: start Exqlite management pool, no Ecto Repo
        data_dir = cfg.database.data_dir || "./data"
        File.mkdir_p!(data_dir)
        mgmt_path = Path.join(data_dir, "#{cfg.database.name || "rocket"}.db")

        # Start management pool synchronously before supervisor
        {:ok, mgmt_pid} =
          DBConnection.start_link(Exqlite.Connection,
            database: mgmt_path,
            journal_mode: :wal,
            pool_size: cfg.database.pool_size || 5
          )

        Application.put_env(:rocket, :mgmt_conn, mgmt_pid)

        [
          RocketWeb.Telemetry,
          {Phoenix.PubSub, name: Rocket.PubSub},
          Rocket.MultiApp.AppManager,
          Rocket.MultiApp.Scheduler,
          RocketWeb.Endpoint
        ]
      else
        # PostgreSQL mode: use Ecto Repo as management connection
        [
          RocketWeb.Telemetry,
          Rocket.Repo,
          {Phoenix.PubSub, name: Rocket.PubSub},
          Rocket.MultiApp.AppManager,
          Rocket.MultiApp.Scheduler,
          RocketWeb.Endpoint
        ]
      end

    opts = [strategy: :one_for_one, name: Rocket.Supervisor]
    Supervisor.start_link(children, opts)
  end

  @impl true
  def config_change(changed, _new, removed) do
    RocketWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
