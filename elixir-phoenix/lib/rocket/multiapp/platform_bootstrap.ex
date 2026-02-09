defmodule Rocket.MultiApp.PlatformBootstrap do
  @moduledoc "Bootstrap platform tables in the management database."

  alias Rocket.Store.Postgres
  require Logger

  @platform_tables [
    """
    CREATE TABLE IF NOT EXISTS _apps (
      name TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      db_name TEXT NOT NULL UNIQUE,
      jwt_secret TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS _platform_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      roles TEXT[] DEFAULT '{platform_admin}',
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS _platform_refresh_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES _platform_users(id) ON DELETE CASCADE,
      token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_platform_refresh_tokens_token ON _platform_refresh_tokens(token)",
    "CREATE INDEX IF NOT EXISTS idx_platform_refresh_tokens_expires ON _platform_refresh_tokens(expires_at)"
  ]

  def bootstrap(conn) do
    Enum.each(@platform_tables, fn sql ->
      case Postgres.exec(conn, sql, []) do
        {:ok, _} -> :ok
        {:error, err} -> Logger.error("Platform bootstrap SQL error: #{inspect(err)}")
      end
    end)

    seed_platform_admin(conn)
  end

  defp seed_platform_admin(conn) do
    case Postgres.query_row(conn, "SELECT COUNT(*)::bigint as count FROM _platform_users", []) do
      {:ok, %{"count" => count}} when count > 0 ->
        :ok

      _ ->
        hash = Bcrypt.hash_pwd_salt("changeme")

        case Postgres.exec(conn,
               "INSERT INTO _platform_users (email, password_hash, roles) VALUES ($1, $2, $3)",
               ["platform@localhost", hash, ["platform_admin"]]) do
          {:ok, _} ->
            Logger.warning("Default platform admin created (platform@localhost / changeme) — change the password immediately")

          {:error, err} ->
            Logger.error("Failed to seed platform admin: #{inspect(err)}")
        end
    end
  end
end
