defmodule Rocket.Store.Bootstrap do
  @moduledoc "Creates system tables and seeds the admin user."

  alias Rocket.Store

  def bootstrap(conn) do
    dialect = Store.dialect()

    dialect.system_tables_sql()
    |> String.split(";")
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.each(fn sql ->
      Store.exec!(conn, sql)
    end)

    seed_admin_user(conn, dialect)
  end

  defp seed_admin_user(conn, dialect) do
    case Store.query_row(conn, "SELECT COUNT(*) as count FROM _users") do
      {:ok, %{"count" => count}} when count == 0 or count == false ->
        hash = Bcrypt.hash_pwd_salt("changeme")
        roles = dialect.array_param(["admin"])

        {sql, params} =
          if dialect.uuid_default() == "" do
            # SQLite: no DEFAULT gen_random_uuid(), generate UUID manually
            id = Ecto.UUID.generate()

            {"INSERT INTO _users (id, email, password_hash, roles) VALUES ($1, $2, $3, $4)",
             [id, "admin@localhost", hash, roles]}
          else
            {"INSERT INTO _users (email, password_hash, roles) VALUES ($1, $2, $3)",
             ["admin@localhost", hash, roles]}
          end

        Store.exec!(conn, sql, params)

        require Logger

        Logger.warning(
          "Default admin user created (admin@localhost / changeme) — change the password immediately."
        )

      _ ->
        :ok
    end
  end
end
