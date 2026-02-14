defmodule Rocket.Store.DialectPostgres do
  @moduledoc """
  PostgreSQL implementation of the `Rocket.Store.Dialect` behaviour.

  Handles SQL generation, type mapping, DDL for system/platform tables,
  and database lifecycle operations specific to PostgreSQL.
  """

  @behaviour Rocket.Store.Dialect

  alias Rocket.Store

  # ---------------------------------------------------------------------------
  # Metadata
  # ---------------------------------------------------------------------------

  @impl true
  def name, do: "postgres"

  @impl true
  def placeholder(n), do: "$#{n}"

  @impl true
  def now_expr, do: "NOW()"

  @impl true
  def uuid_default, do: "DEFAULT gen_random_uuid()"

  # ---------------------------------------------------------------------------
  # DDL / types
  # ---------------------------------------------------------------------------

  @impl true
  def column_type("string", _precision), do: "TEXT"
  def column_type("text", _precision), do: "TEXT"
  def column_type("int", _precision), do: "INTEGER"
  def column_type("integer", _precision), do: "INTEGER"
  def column_type("bigint", _precision), do: "BIGINT"
  def column_type("float", _precision), do: "DOUBLE PRECISION"
  def column_type("decimal", precision) when is_integer(precision) and precision > 0, do: "NUMERIC(18,#{precision})"
  def column_type("decimal", _precision), do: "NUMERIC"
  def column_type("boolean", _precision), do: "BOOLEAN"
  def column_type("uuid", _precision), do: "UUID"
  def column_type("timestamp", _precision), do: "TIMESTAMPTZ"
  def column_type("date", _precision), do: "DATE"
  def column_type("json", _precision), do: "JSONB"
  def column_type("file", _precision), do: "JSONB"
  def column_type(_type, _precision), do: "TEXT"

  @impl true
  def system_tables_sql do
    [
      """
      CREATE TABLE IF NOT EXISTS _entities (
          name        TEXT PRIMARY KEY,
          table_name  TEXT NOT NULL UNIQUE,
          definition  JSONB NOT NULL,
          created_at  TIMESTAMPTZ DEFAULT NOW(),
          updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
      """,
      """
      CREATE TABLE IF NOT EXISTS _relations (
          name        TEXT PRIMARY KEY,
          source      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
          target      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
          definition  JSONB NOT NULL,
          created_at  TIMESTAMPTZ DEFAULT NOW(),
          updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
      """,
      """
      CREATE TABLE IF NOT EXISTS _rules (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          entity      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
          hook        TEXT NOT NULL DEFAULT 'before_write',
          type        TEXT NOT NULL,
          definition  JSONB NOT NULL,
          priority    INT NOT NULL DEFAULT 0,
          active      BOOLEAN NOT NULL DEFAULT true,
          created_at  TIMESTAMPTZ DEFAULT NOW(),
          updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
      """,
      """
      CREATE TABLE IF NOT EXISTS _state_machines (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          entity      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
          field       TEXT NOT NULL,
          definition  JSONB NOT NULL,
          active      BOOLEAN NOT NULL DEFAULT true,
          created_at  TIMESTAMPTZ DEFAULT NOW(),
          updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
      """,
      """
      CREATE TABLE IF NOT EXISTS _workflows (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name        TEXT NOT NULL UNIQUE,
          trigger     JSONB NOT NULL,
          context     JSONB NOT NULL DEFAULT '{}',
          steps       JSONB NOT NULL DEFAULT '[]',
          active      BOOLEAN NOT NULL DEFAULT true,
          created_at  TIMESTAMPTZ DEFAULT NOW(),
          updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
      """,
      """
      CREATE TABLE IF NOT EXISTS _workflow_instances (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          workflow_id           UUID NOT NULL REFERENCES _workflows(id) ON DELETE CASCADE,
          workflow_name         TEXT NOT NULL,
          status                TEXT NOT NULL DEFAULT 'running',
          current_step          TEXT,
          current_step_deadline TIMESTAMPTZ,
          context               JSONB NOT NULL DEFAULT '{}',
          history               JSONB NOT NULL DEFAULT '[]',
          created_at            TIMESTAMPTZ DEFAULT NOW(),
          updated_at            TIMESTAMPTZ DEFAULT NOW()
      )
      """,
      """
      CREATE TABLE IF NOT EXISTS _users (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email         TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          roles         TEXT[] DEFAULT '{}',
          active        BOOLEAN DEFAULT true,
          created_at    TIMESTAMPTZ DEFAULT NOW(),
          updated_at    TIMESTAMPTZ DEFAULT NOW()
      )
      """,
      """
      CREATE TABLE IF NOT EXISTS _refresh_tokens (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id    UUID NOT NULL REFERENCES _users(id) ON DELETE CASCADE,
          token      UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
      )
      """,
      "CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON _refresh_tokens(token)",
      "CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON _refresh_tokens(expires_at)",
      """
      CREATE TABLE IF NOT EXISTS _permissions (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          entity     TEXT NOT NULL,
          action     TEXT NOT NULL,
          roles      TEXT[] NOT NULL DEFAULT '{}',
          conditions JSONB DEFAULT '[]',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
      )
      """,
      """
      CREATE TABLE IF NOT EXISTS _webhooks (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          entity     TEXT NOT NULL,
          hook       TEXT NOT NULL DEFAULT 'after_write',
          url        TEXT NOT NULL,
          method     TEXT NOT NULL DEFAULT 'POST',
          headers    JSONB DEFAULT '{}',
          condition  TEXT DEFAULT '',
          async      BOOLEAN NOT NULL DEFAULT true,
          retry      JSONB DEFAULT '{"max_attempts": 3, "backoff": "exponential"}',
          active     BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
      )
      """,
      """
      CREATE TABLE IF NOT EXISTS _webhook_logs (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          webhook_id      UUID NOT NULL REFERENCES _webhooks(id) ON DELETE CASCADE,
          entity          TEXT NOT NULL,
          hook            TEXT NOT NULL,
          url             TEXT NOT NULL,
          method          TEXT NOT NULL,
          request_headers JSONB DEFAULT '{}',
          request_body    JSONB DEFAULT '{}',
          response_status INT,
          response_body   TEXT DEFAULT '',
          status          TEXT NOT NULL DEFAULT 'pending',
          attempt         INT NOT NULL DEFAULT 0,
          max_attempts    INT NOT NULL DEFAULT 3,
          next_retry_at   TIMESTAMPTZ,
          error           TEXT DEFAULT '',
          idempotency_key TEXT NOT NULL,
          created_at      TIMESTAMPTZ DEFAULT NOW(),
          updated_at      TIMESTAMPTZ DEFAULT NOW()
      )
      """,
      "CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON _webhook_logs(status)",
      "CREATE INDEX IF NOT EXISTS idx_webhook_logs_retry ON _webhook_logs(next_retry_at) WHERE status = 'retrying'",
      """
      CREATE TABLE IF NOT EXISTS _files (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          filename      TEXT NOT NULL,
          storage_path  TEXT NOT NULL,
          mime_type     TEXT NOT NULL DEFAULT 'application/octet-stream',
          size          BIGINT NOT NULL DEFAULT 0,
          uploaded_by   UUID,
          created_at    TIMESTAMPTZ DEFAULT NOW()
      )
      """,
      """
      CREATE TABLE IF NOT EXISTS _ui_configs (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          entity     TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
          scope      TEXT NOT NULL DEFAULT 'default',
          config     JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(entity, scope)
      )
      """,
      """
      CREATE TABLE IF NOT EXISTS _events (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          trace_id        UUID NOT NULL,
          span_id         UUID NOT NULL,
          parent_span_id  UUID,
          event_type      TEXT NOT NULL,
          source          TEXT NOT NULL,
          component       TEXT NOT NULL,
          action          TEXT NOT NULL,
          entity          TEXT,
          record_id       TEXT,
          user_id         UUID,
          duration_ms     DOUBLE PRECISION,
          status          TEXT,
          metadata        JSONB,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
      """,
      "CREATE INDEX IF NOT EXISTS idx_events_trace ON _events (trace_id)",
      "CREATE INDEX IF NOT EXISTS idx_events_entity_created ON _events (entity, created_at DESC)",
      "CREATE INDEX IF NOT EXISTS idx_events_created ON _events (created_at DESC)",
      "CREATE INDEX IF NOT EXISTS idx_events_type_source ON _events (event_type, source)"
    ]
    |> Enum.join(";\n")
  end

  @impl true
  def platform_tables_sql do
    [
      """
      CREATE TABLE IF NOT EXISTS _apps (
        name TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        db_name TEXT NOT NULL UNIQUE,
        db_driver TEXT NOT NULL DEFAULT 'postgres',
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
    |> Enum.join(";\n")
  end

  # ---------------------------------------------------------------------------
  # Introspection
  # ---------------------------------------------------------------------------

  @impl true
  def table_exists?(conn, table_name) do
    case Store.query_row(
           conn,
           "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public') as exists",
           [table_name]
         ) do
      {:ok, %{"exists" => true}} -> true
      _ -> false
    end
  end

  @impl true
  def get_columns(conn, table_name) do
    case Store.query_rows(
           conn,
           "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'",
           [table_name]
         ) do
      {:ok, rows} ->
        Map.new(rows, fn r -> {r["column_name"], r["data_type"]} end)

      _ ->
        %{}
    end
  end

  # ---------------------------------------------------------------------------
  # Index helpers
  # ---------------------------------------------------------------------------

  @impl true
  def soft_delete_index_sql(table) do
    "CREATE INDEX IF NOT EXISTS idx_#{table}_deleted_at ON #{table} (deleted_at) WHERE deleted_at IS NULL"
  end

  # ---------------------------------------------------------------------------
  # Query expression helpers
  # ---------------------------------------------------------------------------

  @impl true
  def in_expr(field, values, offset) do
    {"#{field} = ANY($#{offset + 1})", [values], offset + 1}
  end

  @impl true
  def not_in_expr(field, values, offset) do
    {"#{field} != ALL($#{offset + 1})", [values], offset + 1}
  end

  @impl true
  def interval_delete_expr(col, offset) do
    {"#{col} < now() - ($#{offset + 1} || ' days')::interval", offset + 1}
  end

  # ---------------------------------------------------------------------------
  # Array encoding / decoding
  # ---------------------------------------------------------------------------

  @impl true
  def array_param(vals), do: vals

  @impl true
  def scan_array(raw) when is_list(raw), do: Enum.map(raw, &to_string/1)
  def scan_array(nil), do: []
  def scan_array(_), do: []

  # ---------------------------------------------------------------------------
  # Aggregate helpers
  # ---------------------------------------------------------------------------

  @impl true
  def filter_count_expr(condition) do
    "COUNT(*) FILTER (WHERE #{condition})"
  end

  # ---------------------------------------------------------------------------
  # Performance / capability flags
  # ---------------------------------------------------------------------------

  @impl true
  def sync_commit_off, do: "SET LOCAL synchronous_commit = off"

  @impl true
  def supports_percentile?, do: true

  @impl true
  def needs_bool_fix?, do: false

  # ---------------------------------------------------------------------------
  # Database lifecycle
  # ---------------------------------------------------------------------------

  @impl true
  def create_database(conn, db_name, _data_dir) do
    case Store.exec(conn, "CREATE DATABASE #{db_name}", []) do
      {:ok, _} ->
        :ok

      {:error, %Postgrex.Error{postgres: %{code: :duplicate_database}}} ->
        :ok

      {:error, err} ->
        err_str = inspect(err)

        if String.contains?(err_str, "already exists") do
          :ok
        else
          {:error, err}
        end
    end
  end

  @impl true
  def drop_database(conn, db_name, _data_dir) do
    # Terminate active connections to the target database first
    Store.exec(
      conn,
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [db_name]
    )

    case Store.exec(conn, "DROP DATABASE IF EXISTS #{db_name}", []) do
      {:ok, _} -> :ok
      {:error, err} -> {:error, err}
    end
  end
end
