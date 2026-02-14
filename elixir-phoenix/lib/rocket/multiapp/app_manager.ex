defmodule Rocket.MultiApp.AppManager do
  @moduledoc "GenServer managing per-app lifecycle: create, get, delete, list."
  use GenServer
  require Logger

  alias Rocket.Store
  alias Rocket.MultiApp.{AppContext, PlatformBootstrap}

  @valid_app_name_re ~r/^[a-z][a-z0-9_-]{0,62}$/

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # ── Client API ──

  def get(app_name), do: GenServer.call(__MODULE__, {:get, app_name})
  def create(name, display_name, db_driver \\ nil), do: GenServer.call(__MODULE__, {:create, name, display_name, db_driver}, 30_000)
  def delete(name), do: GenServer.call(__MODULE__, {:delete, name}, 30_000)
  def delete_async(name), do: GenServer.call(__MODULE__, {:delete_async, name})
  def list_apps, do: GenServer.call(__MODULE__, :list)
  def get_app_info(name), do: GenServer.call(__MODULE__, {:get_info, name})
  def all_contexts, do: GenServer.call(__MODULE__, :all_contexts)

  # ── Server ──

  @impl true
  def init(_opts) do
    db_config = Application.get_env(:rocket, :db_config) || []

    state = %{
      apps: %{},
      db_config: db_config
    }

    {:ok, state, {:continue, :bootstrap_and_load}}
  end

  @impl true
  def handle_continue(:bootstrap_and_load, state) do
    try do
      PlatformBootstrap.bootstrap(Store.mgmt_conn())
      state = load_all_apps(state)
      {:noreply, state}
    rescue
      e ->
        Logger.error("AppManager bootstrap failed: #{inspect(e)}")
        {:noreply, state}
    end
  end

  @impl true
  def handle_call({:get, app_name}, _from, state) do
    case Map.get(state.apps, app_name) do
      nil ->
        case init_app(app_name, state.db_config) do
          {:ok, ctx} ->
            state = put_in(state.apps[app_name], ctx)
            {:reply, {:ok, ctx}, state}

          {:error, err} ->
            {:reply, {:error, err}, state}
        end

      ctx ->
        {:reply, {:ok, ctx}, state}
    end
  end

  def handle_call({:create, name, display_name, db_driver}, _from, state) do
    if !Regex.match?(@valid_app_name_re, name) do
      {:reply, {:error, "Invalid app name. Must start with a lowercase letter and contain only lowercase letters, numbers, hyphens, underscores (max 63 chars)."}, state}
    else
      display_name = if display_name == nil || display_name == "", do: name, else: display_name
      db_name = "rocket_#{name}"
      jwt_secret = generate_jwt_secret()
      # Use requested driver, falling back to system default
      db_driver = if db_driver in ["postgres", "sqlite"], do: db_driver, else: Store.dialect().name()
      app_dialect = Rocket.Store.Dialect.new(db_driver)
      mgmt = Store.mgmt_conn()
      data_dir = state.db_config[:data_dir] || "./data"

      # Create database using the app's dialect
      case app_dialect.create_database(mgmt, db_name, data_dir) do
        :ok ->
          # Insert into _apps with db_driver
          case Store.exec(mgmt,
                 "INSERT INTO _apps (name, display_name, db_name, db_driver, jwt_secret, status) VALUES ($1, $2, $3, $4, $5, $6)",
                 [name, display_name, db_name, db_driver, jwt_secret, "active"]) do
            {:ok, _} ->
              case AppContext.init(name, db_name, jwt_secret, state.db_config, db_driver) do
                {:ok, ctx} ->
                  state = put_in(state.apps[name], ctx)

                  info = %{
                    name: name,
                    display_name: display_name,
                    db_name: db_name,
                    db_driver: db_driver,
                    status: "active"
                  }

                  {:reply, {:ok, info}, state}

                {:error, err} ->
                  {:reply, {:error, "App created but init failed: #{inspect(err)}"}, state}
              end

            {:error, err} ->
              {:reply, {:error, "Failed to register app: #{inspect(err)}"}, state}
          end

        {:error, err} ->
          {:reply, {:error, "Failed to create database: #{inspect(err)}"}, state}
      end
    end
  end

  def handle_call({:delete, name}, _from, state) do
    # Stop app context if cached
    case Map.get(state.apps, name) do
      nil -> :ok
      ctx -> AppContext.stop(ctx)
    end

    state = %{state | apps: Map.delete(state.apps, name)}
    mgmt = Store.mgmt_conn()
    data_dir = state.db_config[:data_dir] || "./data"

    # Get db_name and db_driver from _apps to use the correct dialect for drop
    case Store.query_row(mgmt,
           "SELECT db_name, db_driver FROM _apps WHERE name = $1",
           [name]) do
      {:ok, %{"db_name" => db_name} = row} ->
        app_driver = row["db_driver"] || Store.dialect().name()
        app_dialect = Rocket.Store.Dialect.new(app_driver)
        Store.exec(mgmt, "DELETE FROM _apps WHERE name = $1", [name])
        app_dialect.drop_database(mgmt, db_name, data_dir)
        {:reply, :ok, state}

      {:error, :not_found} ->
        {:reply, {:error, "App not found: #{name}"}, state}

      {:error, err} ->
        {:reply, {:error, inspect(err)}, state}
    end
  end

  def handle_call({:delete_async, name}, _from, state) do
    # Stop app context if cached
    case Map.get(state.apps, name) do
      nil -> :ok
      ctx -> AppContext.stop(ctx)
    end

    state = %{state | apps: Map.delete(state.apps, name)}
    mgmt = Store.mgmt_conn()
    data_dir = state.db_config[:data_dir] || "./data"

    case Store.query_row(mgmt,
           "SELECT db_name, db_driver FROM _apps WHERE name = $1",
           [name]) do
      {:ok, %{"db_name" => db_name} = row} ->
        app_driver = row["db_driver"] || Store.dialect().name()
        app_dialect = Rocket.Store.Dialect.new(app_driver)
        Store.exec(mgmt, "DELETE FROM _apps WHERE name = $1", [name])

        # Drop the database in the background so the response is immediate
        Task.start(fn ->
          app_dialect.drop_database(mgmt, db_name, data_dir)
          Logger.info("Dropped database #{db_name} for app #{name}")
        end)

        {:reply, :ok, state}

      {:error, :not_found} ->
        {:reply, {:error, "App not found: #{name}"}, state}

      {:error, err} ->
        {:reply, {:error, inspect(err)}, state}
    end
  end

  def handle_call(:list, _from, state) do
    case Store.query_rows(Store.mgmt_conn(),
           "SELECT name, display_name, db_name, db_driver, status, created_at, updated_at FROM _apps ORDER BY name") do
      {:ok, rows} -> {:reply, {:ok, rows}, state}
      {:error, err} -> {:reply, {:error, err}, state}
    end
  end

  def handle_call({:get_info, name}, _from, state) do
    case Store.query_row(Store.mgmt_conn(),
           "SELECT name, display_name, db_name, db_driver, status, created_at, updated_at FROM _apps WHERE name = $1",
           [name]) do
      {:ok, row} -> {:reply, {:ok, row}, state}
      {:error, :not_found} -> {:reply, {:error, "App not found: #{name}"}, state}
      {:error, err} -> {:reply, {:error, err}, state}
    end
  end

  def handle_call(:all_contexts, _from, state) do
    {:reply, Map.values(state.apps), state}
  end

  # ── Private ──

  defp load_all_apps(state) do
    case Store.query_rows(Store.mgmt_conn(),
           "SELECT name, db_name, db_driver, jwt_secret FROM _apps WHERE status = 'active'") do
      {:ok, rows} ->
        Enum.reduce(rows, state, fn row, state ->
          name = row["name"]
          db_name = row["db_name"]
          db_driver = row["db_driver"] || Store.dialect().name()
          jwt_secret = row["jwt_secret"]

          case AppContext.init(name, db_name, jwt_secret, state.db_config, db_driver) do
            {:ok, ctx} ->
              Logger.info("Loaded app: #{name} (driver: #{db_driver})")
              put_in(state.apps[name], ctx)

            {:error, err} ->
              Logger.error("Failed to load app #{name}: #{inspect(err)}")
              state
          end
        end)

      {:error, err} ->
        Logger.error("Failed to load apps: #{inspect(err)}")
        state
    end
  end

  defp init_app(app_name, db_config) do
    case Store.query_row(Store.mgmt_conn(),
           "SELECT db_name, db_driver, jwt_secret, status FROM _apps WHERE name = $1",
           [app_name]) do
      {:ok, %{"status" => "active", "db_name" => db_name, "jwt_secret" => jwt_secret} = row} ->
        db_driver = row["db_driver"] || Store.dialect().name()
        AppContext.init(app_name, db_name, jwt_secret, db_config, db_driver)

      {:ok, _} ->
        {:error, "App is not active"}

      {:error, :not_found} ->
        {:error, "App not found: #{app_name}"}

      {:error, err} ->
        {:error, err}
    end
  end

  defp generate_jwt_secret do
    :crypto.strong_rand_bytes(32) |> Base.encode16(case: :lower)
  end
end
