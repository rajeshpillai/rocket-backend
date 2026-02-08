defmodule RocketWeb.AuthController do
  @moduledoc "Authentication endpoints: login, refresh, logout."
  use RocketWeb, :controller

  alias Rocket.Store.Postgres
  alias Rocket.Auth.{JWT, Passwords}
  alias Rocket.Engine.AppError

  # POST /api/auth/login
  def login(conn, params) do
    email = params["email"]
    password = params["password"]

    if !email || email == "" || !password || password == "" do
      respond_error(conn, AppError.new("UNAUTHORIZED", 401, "Invalid email or password"))
    else
      db = get_conn(conn)
      jwt_secret = get_jwt_secret(conn)

      case Postgres.query_row(db,
             "SELECT id, email, password_hash, roles, active FROM _users WHERE email = $1",
             [email]) do
        {:ok, user} ->
          if user["active"] != true do
            respond_error(conn, AppError.new("UNAUTHORIZED", 401, "Account is disabled"))
          else
            if Passwords.check_password(password, user["password_hash"]) do
              roles = extract_roles(user["roles"])

              case generate_token_pair(db, user["id"], roles, jwt_secret) do
                {:ok, pair} ->
                  json(conn, %{data: pair})

                {:error, err} ->
                  respond_error(conn, AppError.new("INTERNAL_ERROR", 500, "Token generation failed: #{inspect(err)}"))
              end
            else
              respond_error(conn, AppError.new("UNAUTHORIZED", 401, "Invalid email or password"))
            end
          end

        {:error, :not_found} ->
          # Run a dummy hash to prevent timing attacks
          Bcrypt.no_user_verify()
          respond_error(conn, AppError.new("UNAUTHORIZED", 401, "Invalid email or password"))

        {:error, err} ->
          respond_error(conn, AppError.new("INTERNAL_ERROR", 500, "#{inspect(err)}"))
      end
    end
  end

  # POST /api/auth/refresh
  def refresh(conn, params) do
    refresh_token = params["refresh_token"]

    if !refresh_token || refresh_token == "" do
      respond_error(conn, AppError.new("UNAUTHORIZED", 401, "Missing refresh token"))
    else
      db = get_conn(conn)
      jwt_secret = get_jwt_secret(conn)

      case Postgres.query_row(db,
             "SELECT rt.id, rt.user_id, rt.expires_at, u.roles, u.active FROM _refresh_tokens rt JOIN _users u ON u.id = rt.user_id WHERE rt.token = $1",
             [refresh_token]) do
        {:ok, row} ->
          expires_at = row["expires_at"]

          cond do
            expired?(expires_at) ->
              Postgres.exec(db, "DELETE FROM _refresh_tokens WHERE id = $1", [row["id"]])
              respond_error(conn, AppError.new("UNAUTHORIZED", 401, "Refresh token expired"))

            row["active"] != true ->
              respond_error(conn, AppError.new("UNAUTHORIZED", 401, "Account is disabled"))

            true ->
              # Token rotation: delete old token
              Postgres.exec(db, "DELETE FROM _refresh_tokens WHERE id = $1", [row["id"]])
              roles = extract_roles(row["roles"])

              case generate_token_pair(db, row["user_id"], roles, jwt_secret) do
                {:ok, pair} ->
                  json(conn, %{data: pair})

                {:error, err} ->
                  respond_error(conn, AppError.new("INTERNAL_ERROR", 500, "#{inspect(err)}"))
              end
          end

        {:error, :not_found} ->
          respond_error(conn, AppError.new("UNAUTHORIZED", 401, "Invalid refresh token"))

        {:error, err} ->
          respond_error(conn, AppError.new("INTERNAL_ERROR", 500, "#{inspect(err)}"))
      end
    end
  end

  # POST /api/auth/logout
  def logout(conn, params) do
    refresh_token = params["refresh_token"]

    if refresh_token && refresh_token != "" do
      db = get_conn(conn)
      Postgres.exec(db, "DELETE FROM _refresh_tokens WHERE token = $1", [refresh_token])
    end

    json(conn, %{message: "Logged out"})
  end

  # ── Helpers ──

  defp generate_token_pair(db, user_id, roles, secret) do
    with {:ok, access_token} <- JWT.generate_access_token(user_id, roles, secret) do
      refresh_token = JWT.generate_refresh_token()
      expires_at = DateTime.utc_now() |> DateTime.add(JWT.refresh_ttl(), :second)

      case Postgres.exec(db,
             "INSERT INTO _refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)",
             [user_id, refresh_token, expires_at]) do
        {:ok, _} ->
          {:ok, %{access_token: access_token, refresh_token: refresh_token}}

        {:error, err} ->
          {:error, err}
      end
    end
  end

  defp expired?(nil), do: true

  defp expired?(expires_at) when is_binary(expires_at) do
    case DateTime.from_iso8601(expires_at) do
      {:ok, dt, _} -> DateTime.compare(DateTime.utc_now(), dt) == :gt
      _ -> true
    end
  end

  defp expired?(%DateTime{} = dt) do
    DateTime.compare(DateTime.utc_now(), dt) == :gt
  end

  defp expired?(%NaiveDateTime{} = ndt) do
    NaiveDateTime.compare(NaiveDateTime.utc_now(), ndt) == :gt
  end

  defp expired?(_), do: true

  defp extract_roles(roles) when is_list(roles), do: Enum.map(roles, &to_string/1)
  defp extract_roles(_), do: []

  defp get_conn(conn), do: conn.assigns[:db_conn] || Rocket.Repo
  defp get_jwt_secret(conn), do: conn.assigns[:jwt_secret] || Application.get_env(:rocket, :jwt_secret, "rocket-dev-secret")

  defp respond_error(conn, %AppError{} = err) do
    conn
    |> put_status(err.status)
    |> json(%{error: AppError.to_json(err)})
  end
end
