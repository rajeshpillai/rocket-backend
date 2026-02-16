defmodule Rocket.Repo do
  use Ecto.Repo,
    otp_app: :rocket,
    adapter: Ecto.Adapters.Postgres
end
