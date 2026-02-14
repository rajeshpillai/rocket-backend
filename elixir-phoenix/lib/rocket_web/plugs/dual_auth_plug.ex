defmodule RocketWeb.Plugs.DualAuthPlug do
  @moduledoc "Dual-auth plug: tries app JWT first, falls back to platform JWT (with admin role)."
  import Plug.Conn
  import Phoenix.Controller, only: [json: 2]

  alias Rocket.Auth.JWT
  alias Rocket.Instrument.Instrumenter

  def init(opts), do: opts

  def call(conn, _opts) do
    span = Instrumenter.start_span("auth", "jwt", "auth.validate")

    try do
      app_secret = conn.assigns[:jwt_secret]
      platform_secret = Application.get_env(:rocket, :platform_jwt_secret, "rocket-platform-secret")

      case get_req_header(conn, "authorization") do
        [auth_header | _] ->
          case parse_bearer(auth_header) do
            {:ok, token} ->
              # Try app JWT first
              case try_app_auth(token, app_secret) do
                {:ok, user} ->
                  _span = Instrumenter.set_status(span, "ok")
                  Instrumenter.set_user_id(user["id"])
                  assign(conn, :current_user, user)

                :error ->
                  # Fall back to platform JWT (elevated to admin)
                  case try_platform_auth(token, platform_secret) do
                    {:ok, user} ->
                      _span = Instrumenter.set_status(span, "ok")
                      Instrumenter.set_user_id(user["id"])
                      assign(conn, :current_user, user)

                    :error ->
                      _span = Instrumenter.set_status(span, "error")
                      unauthorized(conn, "Invalid or expired token")
                  end
              end

            :error ->
              _span = Instrumenter.set_status(span, "error")
              unauthorized(conn, "Invalid auth header format")
          end

        [] ->
          _span = Instrumenter.set_status(span, "error")
          unauthorized(conn, "Missing auth token")
      end
    after
      Instrumenter.end_span(span)
    end
  end

  defp try_app_auth(_token, nil), do: :error

  defp try_app_auth(token, secret) do
    case JWT.parse_access_token(token, secret) do
      {:ok, claims} ->
        {:ok, %{
          "id" => claims["sub"],
          "roles" => claims["roles"] || []
        }}

      {:error, _} ->
        :error
    end
  end

  defp try_platform_auth(token, secret) do
    case JWT.parse_access_token(token, secret) do
      {:ok, claims} ->
        roles = claims["roles"] || []
        # Elevate platform user to admin in app context
        roles = if "admin" in roles, do: roles, else: roles ++ ["admin"]

        {:ok, %{
          "id" => claims["sub"],
          "roles" => roles
        }}

      {:error, _} ->
        :error
    end
  end

  defp parse_bearer(header) do
    case String.split(header, " ", parts: 2) do
      [scheme, token] when byte_size(token) > 0 ->
        if String.downcase(scheme) == "bearer", do: {:ok, token}, else: :error

      _ ->
        :error
    end
  end

  defp unauthorized(conn, message) do
    conn
    |> put_status(401)
    |> json(%{error: %{code: "UNAUTHORIZED", message: message}})
    |> halt()
  end
end
