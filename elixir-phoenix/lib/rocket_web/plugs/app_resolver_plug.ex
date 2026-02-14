defmodule RocketWeb.Plugs.AppResolverPlug do
  @moduledoc "Plug that resolves :app param to AppContext and injects db_conn + registry + jwt_secret."
  import Plug.Conn
  import Phoenix.Controller, only: [json: 2]

  alias Rocket.MultiApp.AppManager

  def init(opts), do: opts

  def call(conn, _opts) do
    app_name = conn.params["app"] || conn.path_params["app"]

    if app_name == nil || app_name == "" do
      conn
      |> put_status(404)
      |> json(%{error: %{code: "APP_NOT_FOUND", message: "App name is required"}})
      |> halt()
    else
      case AppManager.get(app_name) do
        {:ok, ctx} ->
          # Set per-app dialect in process dictionary for this request
          if ctx.dialect, do: Process.put(:rocket_dialect, ctx.dialect)

          conn
          |> assign(:app_context, ctx)
          |> assign(:db_conn, ctx.db_pool)
          |> assign(:registry, ctx.registry)
          |> assign(:jwt_secret, ctx.jwt_secret)

        {:error, err} ->
          conn
          |> put_status(404)
          |> json(%{error: %{code: "APP_NOT_FOUND", message: "App not found: #{err}"}})
          |> halt()
      end
    end
  end
end
