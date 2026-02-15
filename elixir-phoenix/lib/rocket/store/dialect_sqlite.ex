defmodule Rocket.Store.DialectSqlite do
  @moduledoc """
  SQLite dialect implementation.

  Maps metadata field types to SQLite column types, provides DDL for system
  and platform tables, and handles SQLite-specific query expression building.
  UUIDs are generated in application code (no DEFAULT expression).
  Arrays are stored as JSON text strings.
  """

  @behaviour Rocket.Store.Dialect

  # ---------------------------------------------------------------------------
  # Metadata
  # ---------------------------------------------------------------------------

  @impl true
  def name, do: "sqlite"

  @impl true
  def placeholder(n), do: "?#{n}"

  @impl true
  def now_expr, do: "datetime('now')"

  @impl true
  def uuid_default, do: ""

  # ---------------------------------------------------------------------------
  # DDL / types
  # ---------------------------------------------------------------------------

  @impl true
  def column_type(field_type, _precision \\ nil) do
    case field_type do
      t when t in ["string", "text"] -> "TEXT"
      t when t in ["int", "integer"] -> "INTEGER"
      "bigint" -> "INTEGER"
      "float" -> "REAL"
      "decimal" -> "REAL"
      "boolean" -> "INTEGER"
      "uuid" -> "TEXT"
      "timestamp" -> "TEXT"
      "date" -> "TEXT"
      t when t in ["json", "file"] -> "TEXT"
      _ -> "TEXT"
    end
  end

  @impl true
  def system_tables_sql do
    ~s"""
    CREATE TABLE IF NOT EXISTS _entities (
        name        TEXT PRIMARY KEY,
        table_name  TEXT NOT NULL UNIQUE,
        definition  TEXT NOT NULL,
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _relations (
        name        TEXT PRIMARY KEY,
        source      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
        target      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
        definition  TEXT NOT NULL,
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _rules (
        id          TEXT PRIMARY KEY,
        entity      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
        hook        TEXT NOT NULL DEFAULT 'before_write',
        type        TEXT NOT NULL,
        definition  TEXT NOT NULL,
        priority    INTEGER NOT NULL DEFAULT 0,
        active      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _state_machines (
        id          TEXT PRIMARY KEY,
        entity      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
        field       TEXT NOT NULL,
        definition  TEXT NOT NULL,
        active      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _workflows (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        trigger     TEXT NOT NULL,
        context     TEXT NOT NULL DEFAULT '{}',
        steps       TEXT NOT NULL DEFAULT '[]',
        active      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _workflow_instances (
        id                    TEXT PRIMARY KEY,
        workflow_id           TEXT NOT NULL REFERENCES _workflows(id) ON DELETE CASCADE,
        workflow_name         TEXT NOT NULL,
        status                TEXT NOT NULL DEFAULT 'running',
        current_step          TEXT,
        current_step_deadline TEXT,
        context               TEXT NOT NULL DEFAULT '{}',
        history               TEXT NOT NULL DEFAULT '[]',
        created_at            TEXT DEFAULT (datetime('now')),
        updated_at            TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _users (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        roles         TEXT DEFAULT '[]',
        active        INTEGER DEFAULT 1,
        created_at    TEXT DEFAULT (datetime('now')),
        updated_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _refresh_tokens (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES _users(id) ON DELETE CASCADE,
        token      TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON _refresh_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON _refresh_tokens(expires_at);

    CREATE TABLE IF NOT EXISTS _permissions (
        id         TEXT PRIMARY KEY,
        entity     TEXT NOT NULL,
        action     TEXT NOT NULL,
        roles      TEXT NOT NULL DEFAULT '[]',
        conditions TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _webhooks (
        id         TEXT PRIMARY KEY,
        entity     TEXT NOT NULL,
        hook       TEXT NOT NULL DEFAULT 'after_write',
        url        TEXT NOT NULL,
        method     TEXT NOT NULL DEFAULT 'POST',
        headers    TEXT DEFAULT '{}',
        condition  TEXT DEFAULT '',
        async      INTEGER NOT NULL DEFAULT 1,
        retry      TEXT DEFAULT '{"max_attempts": 3, "backoff": "exponential"}',
        active     INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _webhook_logs (
        id              TEXT PRIMARY KEY,
        webhook_id      TEXT NOT NULL REFERENCES _webhooks(id) ON DELETE CASCADE,
        entity          TEXT NOT NULL,
        hook            TEXT NOT NULL,
        url             TEXT NOT NULL,
        method          TEXT NOT NULL,
        request_headers TEXT DEFAULT '{}',
        request_body    TEXT DEFAULT '{}',
        response_status INTEGER,
        response_body   TEXT DEFAULT '',
        status          TEXT NOT NULL DEFAULT 'pending',
        attempt         INTEGER NOT NULL DEFAULT 0,
        max_attempts    INTEGER NOT NULL DEFAULT 3,
        next_retry_at   TEXT,
        error           TEXT DEFAULT '',
        idempotency_key TEXT NOT NULL,
        created_at      TEXT DEFAULT (datetime('now')),
        updated_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON _webhook_logs(status);
    CREATE INDEX IF NOT EXISTS idx_webhook_logs_retry ON _webhook_logs(next_retry_at) WHERE status = 'retrying';

    CREATE TABLE IF NOT EXISTS _files (
        id            TEXT PRIMARY KEY,
        filename      TEXT NOT NULL,
        storage_path  TEXT NOT NULL,
        mime_type     TEXT NOT NULL DEFAULT 'application/octet-stream',
        size          INTEGER NOT NULL DEFAULT 0,
        uploaded_by   TEXT,
        created_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _ui_configs (
        id         TEXT PRIMARY KEY,
        entity     TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
        scope      TEXT NOT NULL DEFAULT 'default',
        config     TEXT NOT NULL DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(entity, scope)
    );

    CREATE TABLE IF NOT EXISTS _events (
        id              TEXT PRIMARY KEY,
        trace_id        TEXT NOT NULL,
        span_id         TEXT NOT NULL,
        parent_span_id  TEXT,
        event_type      TEXT NOT NULL,
        source          TEXT NOT NULL,
        component       TEXT NOT NULL,
        action          TEXT NOT NULL,
        entity          TEXT,
        record_id       TEXT,
        user_id         TEXT,
        duration_ms     REAL,
        status          TEXT,
        metadata        TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_events_trace ON _events (trace_id);
    CREATE INDEX IF NOT EXISTS idx_events_entity_created ON _events (entity, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_created ON _events (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_type_source ON _events (event_type, source);

    CREATE TABLE IF NOT EXISTS _invites (
        id          TEXT PRIMARY KEY,
        email       TEXT NOT NULL,
        roles       TEXT DEFAULT '[]',
        token       TEXT NOT NULL UNIQUE,
        expires_at  TEXT NOT NULL,
        accepted_at TEXT,
        invited_by  TEXT,
        created_at  TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_invites_token ON _invites(token);
    CREATE INDEX IF NOT EXISTS idx_invites_email ON _invites(email);
    """
  end

  @impl true
  def platform_tables_sql do
    ~s"""
    CREATE TABLE IF NOT EXISTS _apps (
        name         TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        db_name      TEXT NOT NULL UNIQUE,
        db_driver    TEXT NOT NULL DEFAULT 'sqlite',
        jwt_secret   TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'active',
        created_at   TEXT DEFAULT (datetime('now')),
        updated_at   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _platform_users (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        roles         TEXT DEFAULT '["platform_admin"]',
        active        INTEGER DEFAULT 1,
        created_at    TEXT DEFAULT (datetime('now')),
        updated_at    TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS _platform_refresh_tokens (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES _platform_users(id) ON DELETE CASCADE,
        token      TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_platform_refresh_tokens_token ON _platform_refresh_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_platform_refresh_tokens_expires ON _platform_refresh_tokens(expires_at);
    """
  end

  # ---------------------------------------------------------------------------
  # Introspection
  # ---------------------------------------------------------------------------

  @impl true
  def table_exists?(conn, table_name) do
    sql = "SELECT name FROM sqlite_master WHERE type='table' AND name=?1"

    case Exqlite.query(conn, sql, [table_name]) do
      {:ok, %{rows: [_ | _]}} -> true
      _ -> false
    end
  end

  @impl true
  def get_columns(conn, table_name) do
    sql = "PRAGMA table_info(#{table_name})"

    case Exqlite.query(conn, sql, []) do
      {:ok, %{rows: rows}} ->
        rows
        |> Enum.reduce(%{}, fn row, acc ->
          # PRAGMA table_info returns: [cid, name, type, notnull, dflt_value, pk]
          name = Enum.at(row, 1)
          type = Enum.at(row, 2)
          Map.put(acc, name, type)
        end)

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
  def in_expr(_field, [], offset) do
    {"1=0", [], offset}
  end

  def in_expr(field, values, offset) do
    placeholders =
      values
      |> Enum.with_index(1)
      |> Enum.map(fn {_v, i} -> "?#{offset + i}" end)
      |> Enum.join(", ")

    {"#{field} IN (#{placeholders})", values, offset + length(values)}
  end

  @impl true
  def not_in_expr(_field, [], offset) do
    {"1=1", [], offset}
  end

  def not_in_expr(field, values, offset) do
    placeholders =
      values
      |> Enum.with_index(1)
      |> Enum.map(fn {_v, i} -> "?#{offset + i}" end)
      |> Enum.join(", ")

    {"#{field} NOT IN (#{placeholders})", values, offset + length(values)}
  end

  @impl true
  def interval_delete_expr(col, offset) do
    {"#{col} < datetime('now', '-' || ?#{offset + 1} || ' days')", offset + 1}
  end

  # ---------------------------------------------------------------------------
  # Array encoding / decoding
  # ---------------------------------------------------------------------------

  @impl true
  def array_param(vals) do
    Jason.encode!(vals || [])
  end

  @impl true
  def scan_array(nil), do: []

  def scan_array(raw) when is_list(raw) do
    Enum.map(raw, &to_string/1)
  end

  def scan_array(raw) when is_binary(raw) do
    case Jason.decode(raw) do
      {:ok, list} when is_list(list) -> list
      _ -> []
    end
  end

  def scan_array(_), do: []

  # ---------------------------------------------------------------------------
  # Aggregate helpers
  # ---------------------------------------------------------------------------

  @impl true
  def filter_count_expr(condition) do
    "SUM(CASE WHEN #{condition} THEN 1 ELSE 0 END)"
  end

  # ---------------------------------------------------------------------------
  # Performance / capability flags
  # ---------------------------------------------------------------------------

  @impl true
  def sync_commit_off, do: nil

  @impl true
  def supports_percentile?, do: false

  @impl true
  def needs_bool_fix?, do: true

  # ---------------------------------------------------------------------------
  # Database lifecycle
  # ---------------------------------------------------------------------------

  @impl true
  def create_database(_conn, db_name, data_dir) do
    File.mkdir_p!(data_dir)
    path = Path.join(data_dir, db_name <> ".db")
    unless File.exists?(path), do: File.touch!(path)
    :ok
  end

  @impl true
  def drop_database(_conn, db_name, data_dir) do
    path = Path.join(data_dir, db_name <> ".db")
    File.rm(path <> "-wal")
    File.rm(path <> "-shm")

    case File.rm(path) do
      :ok -> :ok
      {:error, :enoent} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end
end
