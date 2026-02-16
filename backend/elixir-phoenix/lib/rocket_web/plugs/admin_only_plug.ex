defmodule RocketWeb.Plugs.AdminOnlyPlug do
  @moduledoc "Plug that requires the current user to have the admin role."
  import Plug.Conn
  import Phoenix.Controller, only: [json: 2]

  def init(opts), do: opts

  def call(conn, _opts) do
    case conn.assigns[:current_user] do
      %{"roles" => roles} when is_list(roles) ->
        if "admin" in roles do
          conn
        else
          forbidden(conn)
        end

      _ ->
        conn
        |> put_status(401)
        |> json(%{error: %{code: "UNAUTHORIZED", message: "Missing auth token"}})
        |> halt()
    end
  end

  defp forbidden(conn) do
    conn
    |> put_status(403)
    |> json(%{error: %{code: "FORBIDDEN", message: "Admin access required"}})
    |> halt()
  end
end
