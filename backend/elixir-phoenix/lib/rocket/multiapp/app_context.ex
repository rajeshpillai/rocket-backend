defmodule Rocket.MultiApp.AppContext do
  @moduledoc "Per-app context holding database pool, registry, and JWT secret."

  defstruct [
    :name,
    :db_name,
    :jwt_secret,
    :db_pool,
    :registry,
    :event_buffer,
    :dialect
  ]

  @doc "Initialize an AppContext: connect to DB, bootstrap, load metadata."
  def init(name, db_name, jwt_secret, db_config, db_driver \\ nil) do
    # Resolve per-app dialect
    db_driver = db_driver || Rocket.Store.dialect().name()
    app_dialect = Rocket.Store.Dialect.new(db_driver)

    # Set per-app dialect for this init process so Store calls use the right dialect
    Process.put(:rocket_dialect, app_dialect)

    case start_pool(db_name, db_config, app_dialect) do
      {:ok, pool} ->
        # Bootstrap system tables (idempotent)
        Rocket.Store.Bootstrap.bootstrap(pool)

        # Start a dedicated registry for this app
        registry_name = registry_name(name)

        case Rocket.Metadata.Registry.start_link(name: registry_name) do
          {:ok, _pid} -> :ok
          {:error, {:already_started, _pid}} -> :ok
        end

        # Load metadata
        Rocket.Metadata.Loader.load_all(pool, registry_name)

        # Start event buffer for this app
        instr_config = Application.get_env(:rocket, :instrumentation_config) || %{enabled: true, buffer_size: 500, flush_interval_ms: 100}
        event_buffer =
          if instr_config.enabled do
            buf_name = :"rocket_event_buffer_#{name}"
            case Rocket.Instrument.EventBuffer.start_link(
              pool: pool,
              max_size: instr_config.buffer_size,
              flush_interval: instr_config.flush_interval_ms,
              name: buf_name
            ) do
              {:ok, pid} -> pid
              {:error, {:already_started, pid}} -> pid
              _ -> nil
            end
          else
            nil
          end

        ctx = %__MODULE__{
          name: name,
          db_name: db_name,
          jwt_secret: jwt_secret,
          db_pool: pool,
          registry: registry_name,
          event_buffer: event_buffer,
          dialect: app_dialect
        }

        # Clean up process dictionary after init
        Process.delete(:rocket_dialect)
        {:ok, ctx}

      {:error, err} ->
        {:error, err}
    end
  end

  @doc "Stop the app context (close pool, stop registry)."
  def stop(%__MODULE__{} = ctx) do
    if ctx.event_buffer && Process.alive?(ctx.event_buffer) do
      Rocket.Instrument.EventBuffer.stop(ctx.event_buffer)
    end

    if ctx.db_pool && Process.alive?(ctx.db_pool) do
      GenServer.stop(ctx.db_pool)
    end

    registry = registry_name(ctx.name)

    case GenServer.whereis(registry) do
      nil -> :ok
      pid -> GenServer.stop(pid)
    end

    :ok
  rescue
    _ -> :ok
  end

  defp start_pool(db_name, db_config, dialect) do
    case dialect.name() do
      "sqlite" ->
        data_dir = db_config[:data_dir] || "./data"
        path = Path.join(data_dir, "#{db_name}.db")

        DBConnection.start_link(Exqlite.Connection,
          database: path,
          journal_mode: :wal,
          pool_size: db_config[:pool_size] || 5
        )

      _ ->
        opts = [
          hostname: db_config[:hostname] || "localhost",
          port: db_config[:port] || 5433,
          username: db_config[:username] || "rocket",
          password: db_config[:password] || "rocket",
          database: db_name,
          pool_size: db_config[:pool_size] || 5
        ]

        Postgrex.start_link(opts)
    end
  end

  defp registry_name(app_name) do
    :"rocket_registry_#{app_name}"
  end
end
