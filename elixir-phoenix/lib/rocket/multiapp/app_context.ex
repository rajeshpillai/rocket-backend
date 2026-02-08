defmodule Rocket.MultiApp.AppContext do
  @moduledoc "Per-app context holding database pool, registry, and JWT secret."

  defstruct [
    :name,
    :db_name,
    :jwt_secret,
    :db_pool,
    :registry
  ]

  @doc "Initialize an AppContext: connect to DB, bootstrap, load metadata."
  def init(name, db_name, jwt_secret, db_config) do
    case start_pool(db_name, db_config) do
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

        ctx = %__MODULE__{
          name: name,
          db_name: db_name,
          jwt_secret: jwt_secret,
          db_pool: pool,
          registry: registry_name
        }

        {:ok, ctx}

      {:error, err} ->
        {:error, err}
    end
  end

  @doc "Stop the app context (close pool, stop registry)."
  def stop(%__MODULE__{} = ctx) do
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

  defp start_pool(db_name, db_config) do
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

  defp registry_name(app_name) do
    :"rocket_registry_#{app_name}"
  end
end
