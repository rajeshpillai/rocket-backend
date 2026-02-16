defmodule RocketWeb.Plugs.AuthPlug do
  @moduledoc "Plug that validates JWT Bearer token and sets current_user in assigns."
  import Plug.Conn
  import Phoenix.Controller, only: [json: 2]

  alias Rocket.Auth.JWT

  def init(opts), do: opts

  def call(conn, _opts) do
    secret = conn.assigns[:jwt_secret] || Application.get_env(:rocket, :jwt_secret, "rocket-dev-secret")

    case get_req_header(conn, "authorization") do
      [auth_header | _] ->
        case parse_bearer(auth_header) do
          {:ok, token} ->
            case JWT.parse_access_token(token, secret) do
              {:ok, claims} ->
                user = %{
                  "id" => claims["sub"],
                  "roles" => claims["roles"] || []
                }

                assign(conn, :current_user, user)

              {:error, _reason} ->
                unauthorized(conn, "Invalid or expired token")
            end

          :error ->
            unauthorized(conn, "Invalid auth header format")
        end

      [] ->
        unauthorized(conn, "Missing auth token")
    end
  end

  defp parse_bearer(header) do
    case String.split(header, " ", parts: 2) do
      [scheme, token] when byte_size(token) > 0 ->
        if String.downcase(scheme) == "bearer" do
          {:ok, token}
        else
          :error
        end

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
