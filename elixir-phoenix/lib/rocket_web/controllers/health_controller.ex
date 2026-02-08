defmodule RocketWeb.HealthController do
  use RocketWeb, :controller

  def index(conn, _params) do
    json(conn, %{status: "ok"})
  end
end
