defmodule RocketWeb.PlatformController do
  @moduledoc "Platform management endpoints: auth + app CRUD."
  use RocketWeb, :controller

  alias Rocket.Store
  alias Rocket.Auth.{JWT, Passwords}
  alias Rocket.MultiApp.AppManager
  alias Rocket.Engine.AppError

  @valid_app_name_re ~r/^[a-z][a-z0-9_-]{0,62}$/

  # ── Platform Auth ──

  def login(conn, params) do
    email = params["email"]
    password = params["password"]

    if !email || email == "" || !password || password == "" do
      respond_error(conn, AppError.new("UNAUTHORIZED", 401, "Invalid email or password"))
    else
      secret = platform_secret()

      case Store.query_row(Store.mgmt_conn(),
             "SELECT id, email, password_hash, roles, active FROM _platform_users WHERE email = $1",
             [email]) do
        {:ok, user} ->
          if !Store.to_bool(user["active"]) do
            respond_error(conn, AppError.new("UNAUTHORIZED", 401, "Account is disabled"))
          else
            if Passwords.check_password(password, user["password_hash"]) do
              roles = extract_roles(user["roles"])

              case generate_token_pair(user["id"], roles, secret) do
                {:ok, pair} ->
                  json(conn, %{data: pair})

                {:error, err} ->
                  respond_error(conn, AppError.new("INTERNAL_ERROR", 500, "#{inspect(err)}"))
              end
            else
              respond_error(conn, AppError.new("UNAUTHORIZED", 401, "Invalid email or password"))
            end
          end

        {:error, :not_found} ->
          Bcrypt.no_user_verify()
          respond_error(conn, AppError.new("UNAUTHORIZED", 401, "Invalid email or password"))

        {:error, err} ->
          respond_error(conn, AppError.new("INTERNAL_ERROR", 500, "#{inspect(err)}"))
      end
    end
  end

  def refresh(conn, params) do
    refresh_token = params["refresh_token"]

    if !refresh_token || refresh_token == "" do
      respond_error(conn, AppError.new("UNAUTHORIZED", 401, "Missing refresh token"))
    else
      secret = platform_secret()

      case Store.query_row(Store.mgmt_conn(),
             "SELECT rt.id, rt.user_id, rt.expires_at, u.roles, u.active FROM _platform_refresh_tokens rt JOIN _platform_users u ON u.id = rt.user_id WHERE rt.token = $1",
             [refresh_token]) do
        {:ok, row} ->
          cond do
            expired?(row["expires_at"]) ->
              Store.exec(Store.mgmt_conn(), "DELETE FROM _platform_refresh_tokens WHERE id = $1", [row["id"]])
              respond_error(conn, AppError.new("UNAUTHORIZED", 401, "Refresh token expired"))

            !Store.to_bool(row["active"]) ->
              respond_error(conn, AppError.new("UNAUTHORIZED", 401, "Account is disabled"))

            true ->
              Store.exec(Store.mgmt_conn(), "DELETE FROM _platform_refresh_tokens WHERE id = $1", [row["id"]])
              roles = extract_roles(row["roles"])

              case generate_token_pair(row["user_id"], roles, secret) do
                {:ok, pair} -> json(conn, %{data: pair})
                {:error, err} -> respond_error(conn, AppError.new("INTERNAL_ERROR", 500, "#{inspect(err)}"))
              end
          end

        {:error, :not_found} ->
          respond_error(conn, AppError.new("UNAUTHORIZED", 401, "Invalid refresh token"))

        {:error, err} ->
          respond_error(conn, AppError.new("INTERNAL_ERROR", 500, "#{inspect(err)}"))
      end
    end
  end

  def logout(conn, params) do
    refresh_token = params["refresh_token"]

    if refresh_token && refresh_token != "" do
      Store.exec(Store.mgmt_conn(), "DELETE FROM _platform_refresh_tokens WHERE token = $1", [refresh_token])
    end

    json(conn, %{message: "Logged out"})
  end

  # ── AI Status ──

  def ai_status(conn, _params) do
    provider = Application.get_env(:rocket, :ai_provider)

    if provider do
      json(conn, %{data: %{configured: true, model: provider.model}})
    else
      json(conn, %{data: %{configured: false, model: ""}})
    end
  end

  # ── App CRUD ──

  def list_apps(conn, _params) do
    case AppManager.list_apps() do
      {:ok, rows} -> json(conn, %{data: rows})
      {:error, err} -> respond_error(conn, AppError.new("INTERNAL_ERROR", 500, "#{inspect(err)}"))
    end
  end

  def get_app(conn, %{"name" => name}) do
    case AppManager.get_app_info(name) do
      {:ok, row} -> json(conn, %{data: row})
      {:error, err} -> respond_error(conn, AppError.new("NOT_FOUND", 404, "#{err}"))
    end
  end

  def create_app(conn, params) do
    name = params["name"]
    display_name = params["display_name"]
    db_driver = params["db_driver"]

    cond do
      !name || name == "" ->
        respond_error(conn, AppError.new("INVALID_PAYLOAD", 400, "App name is required"))

      !Regex.match?(@valid_app_name_re, name) ->
        respond_error(conn, AppError.new("INVALID_PAYLOAD", 400, "Invalid app name. Must start with a lowercase letter and contain only lowercase letters, numbers, hyphens, underscores (max 63 chars)."))

      db_driver != nil && db_driver not in ["postgres", "sqlite"] ->
        respond_error(conn, AppError.new("VALIDATION_FAILED", 422, "db_driver must be 'postgres' or 'sqlite'"))

      true ->
        case AppManager.create(name, display_name, db_driver) do
          {:ok, info} ->
            conn
            |> put_status(201)
            |> json(%{data: info})

          {:error, err} ->
            respond_error(conn, AppError.new("CONFLICT", 409, "#{err}"))
        end
    end
  end

  def delete_app(conn, %{"name" => name}) do
    case AppManager.delete_async(name) do
      :ok ->
        json(conn, %{data: %{name: name, status: "deleting"}})

      {:error, err} ->
        respond_error(conn, AppError.new("NOT_FOUND", 404, "#{err}"))
    end
  end

  # ── Helpers ──

  defp generate_token_pair(user_id, roles, secret) do
    with {:ok, access_token} <- JWT.generate_access_token(user_id, roles, secret) do
      refresh_token = JWT.generate_refresh_token()
      expires_at = DateTime.utc_now() |> DateTime.add(JWT.refresh_ttl(), :second)

      case Store.exec(Store.mgmt_conn(),
             "INSERT INTO _platform_refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)",
             [user_id, refresh_token, expires_at]) do
        {:ok, _} ->
          {:ok, %{access_token: access_token, refresh_token: refresh_token}}

        {:error, err} ->
          {:error, err}
      end
    end
  end

  defp platform_secret do
    Application.get_env(:rocket, :platform_jwt_secret, "rocket-platform-secret")
  end

  defp expired?(nil), do: true

  defp expired?(expires_at) when is_binary(expires_at) do
    case DateTime.from_iso8601(expires_at) do
      {:ok, dt, _} -> DateTime.compare(DateTime.utc_now(), dt) == :gt
      _ -> true
    end
  end

  defp expired?(%DateTime{} = dt), do: DateTime.compare(DateTime.utc_now(), dt) == :gt
  defp expired?(%NaiveDateTime{} = ndt), do: NaiveDateTime.compare(NaiveDateTime.utc_now(), ndt) == :gt
  defp expired?(_), do: true

  defp extract_roles(roles) when is_list(roles), do: Enum.map(roles, &to_string/1)
  defp extract_roles(roles) when is_binary(roles), do: Store.dialect().scan_array(roles)
  defp extract_roles(_), do: []

  defp respond_error(conn, %AppError{} = err) do
    conn
    |> put_status(err.status)
    |> json(%{error: AppError.to_json(err)})
  end
end
