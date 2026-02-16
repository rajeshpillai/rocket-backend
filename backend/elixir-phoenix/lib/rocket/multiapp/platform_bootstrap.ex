defmodule Rocket.MultiApp.PlatformBootstrap do
  @moduledoc "Bootstrap platform tables in the management database."

  alias Rocket.Store
  require Logger

  def bootstrap(conn) do
    dialect = Store.dialect()

    dialect.platform_tables_sql()
    |> String.split(";")
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.each(fn sql ->
      case Store.exec(conn, sql, []) do
        {:ok, _} -> :ok
        {:error, err} -> Logger.error("Platform bootstrap SQL error: #{inspect(err)}")
      end
    end)

    migrate_apps_table(conn, dialect)
    seed_platform_admin(conn, dialect)
  end

  defp migrate_apps_table(conn, dialect) do
    # Add db_driver column if missing (migration for existing installations)
    cols = dialect.get_columns(conn, "_apps")

    if !Map.has_key?(cols, "db_driver") do
      default_driver = dialect.name()

      case Store.exec(conn, "ALTER TABLE _apps ADD COLUMN db_driver TEXT NOT NULL DEFAULT '#{default_driver}'", []) do
        {:ok, _} ->
          Logger.info("Migrated _apps: added db_driver column (default: #{default_driver})")

        {:error, err} ->
          Logger.error("Failed to add db_driver column: #{inspect(err)}")
      end
    end
  end

  defp seed_platform_admin(conn, dialect) do
    case Store.query_row(conn, "SELECT COUNT(*) as count FROM _platform_users", []) do
      {:ok, %{"count" => count}} when is_integer(count) and count > 0 ->
        :ok

      _ ->
        hash = Bcrypt.hash_pwd_salt("changeme")
        roles = dialect.array_param(["platform_admin"])

        {sql, params} =
          if dialect.uuid_default() == "" do
            # SQLite: no gen_random_uuid(), generate UUID manually
            id = Ecto.UUID.generate()

            {"INSERT INTO _platform_users (id, email, password_hash, roles) VALUES ($1, $2, $3, $4)",
             [id, "platform@localhost", hash, roles]}
          else
            {"INSERT INTO _platform_users (email, password_hash, roles) VALUES ($1, $2, $3)",
             ["platform@localhost", hash, roles]}
          end

        case Store.exec(conn, sql, params) do
          {:ok, _} ->
            Logger.warning("Default platform admin created (platform@localhost / changeme) — change the password immediately")

          {:error, err} ->
            Logger.error("Failed to seed platform admin: #{inspect(err)}")
        end
    end
  end
end
