defmodule Rocket.MultiApp.AppManager do
  @moduledoc "GenServer managing per-app lifecycle: create, get, delete, list."
  use GenServer
  require Logger

  alias Rocket.Store.Postgres
  alias Rocket.MultiApp.{AppContext, PlatformBootstrap}

  @valid_app_name_re ~r/^[a-z][a-z0-9_-]{0,62}$/

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  # ── Client API ──

  def get(app_name), do: GenServer.call(__MODULE__, {:get, app_name})
  def create(name, display_name), do: GenServer.call(__MODULE__, {:create, name, display_name}, 30_000)
  def delete(name), do: GenServer.call(__MODULE__, {:delete, name}, 30_000)
  def delete_async(name), do: GenServer.call(__MODULE__, {:delete_async, name})
  def list_apps, do: GenServer.call(__MODULE__, :list)
  def get_app_info(name), do: GenServer.call(__MODULE__, {:get_info, name})
  def all_contexts, do: GenServer.call(__MODULE__, :all_contexts)

  # ── Server ──

  @impl true
  def init(_opts) do
    db_config = Application.get_env(:rocket, Rocket.Repo) || []

    state = %{
      apps: %{},
      db_config: db_config
    }

    {:ok, state, {:continue, :bootstrap_and_load}}
  end

  @impl true
  def handle_continue(:bootstrap_and_load, state) do
    try do
      PlatformBootstrap.bootstrap(Rocket.Repo)
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

  def handle_call({:create, name, display_name}, _from, state) do
    if !Regex.match?(@valid_app_name_re, name) do
      {:reply, {:error, "Invalid app name. Must start with a lowercase letter and contain only lowercase letters, numbers, hyphens, underscores (max 63 chars)."}, state}
    else
      display_name = if display_name == nil || display_name == "", do: name, else: display_name
      db_name = "rocket_#{name}"
      jwt_secret = generate_jwt_secret()

      # Create database
      case create_database(db_name) do
        :ok ->
          # Insert into _apps
          case Postgres.exec(Rocket.Repo,
                 "INSERT INTO _apps (name, display_name, db_name, jwt_secret, status) VALUES ($1, $2, $3, $4, $5)",
                 [name, display_name, db_name, jwt_secret, "active"]) do
            {:ok, _} ->
              case AppContext.init(name, db_name, jwt_secret, state.db_config) do
                {:ok, ctx} ->
                  state = put_in(state.apps[name], ctx)

                  info = %{
                    name: name,
                    display_name: display_name,
                    db_name: db_name,
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

    # Get db_name from _apps
    case Postgres.query_row(Rocket.Repo,
           "SELECT db_name FROM _apps WHERE name = $1",
           [name]) do
      {:ok, %{"db_name" => db_name}} ->
        Postgres.exec(Rocket.Repo, "DELETE FROM _apps WHERE name = $1", [name])
        drop_database(db_name)
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

    case Postgres.query_row(Rocket.Repo,
           "SELECT db_name FROM _apps WHERE name = $1",
           [name]) do
      {:ok, %{"db_name" => db_name}} ->
        Postgres.exec(Rocket.Repo, "DELETE FROM _apps WHERE name = $1", [name])

        # Drop the database in the background so the response is immediate
        Task.start(fn ->
          drop_database(db_name)
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
    case Postgres.query_rows(Rocket.Repo,
           "SELECT name, display_name, db_name, status, created_at, updated_at FROM _apps ORDER BY name") do
      {:ok, rows} -> {:reply, {:ok, rows}, state}
      {:error, err} -> {:reply, {:error, err}, state}
    end
  end

  def handle_call({:get_info, name}, _from, state) do
    case Postgres.query_row(Rocket.Repo,
           "SELECT name, display_name, db_name, status, created_at, updated_at FROM _apps WHERE name = $1",
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
    case Postgres.query_rows(Rocket.Repo,
           "SELECT name, db_name, jwt_secret FROM _apps WHERE status = 'active'") do
      {:ok, rows} ->
        Enum.reduce(rows, state, fn row, state ->
          name = row["name"]
          db_name = row["db_name"]
          jwt_secret = row["jwt_secret"]

          case AppContext.init(name, db_name, jwt_secret, state.db_config) do
            {:ok, ctx} ->
              Logger.info("Loaded app: #{name}")
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
    case Postgres.query_row(Rocket.Repo,
           "SELECT db_name, jwt_secret, status FROM _apps WHERE name = $1",
           [app_name]) do
      {:ok, %{"status" => "active", "db_name" => db_name, "jwt_secret" => jwt_secret}} ->
        AppContext.init(app_name, db_name, jwt_secret, db_config)

      {:ok, _} ->
        {:error, "App is not active"}

      {:error, :not_found} ->
        {:error, "App not found: #{app_name}"}

      {:error, err} ->
        {:error, err}
    end
  end

  defp create_database(db_name) do
    case Postgres.exec(Rocket.Repo, "CREATE DATABASE #{db_name}", []) do
      {:ok, _} -> :ok
      {:error, %{postgres: %{code: :duplicate_database}}} -> :ok
      {:error, err} ->
        # Check if it's a duplicate database error (string match fallback)
        err_str = inspect(err)
        if String.contains?(err_str, "already exists"), do: :ok, else: {:error, err}
    end
  end

  defp drop_database(db_name) do
    # Terminate connections first
    Postgres.exec(Rocket.Repo,
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [db_name])

    Postgres.exec(Rocket.Repo, "DROP DATABASE IF EXISTS #{db_name}", [])
    :ok
  end

  defp generate_jwt_secret do
    :crypto.strong_rand_bytes(32) |> Base.encode16(case: :lower)
  end
end
