package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// SQLiteDialect implements Dialect for SQLite via modernc.org/sqlite.
type SQLiteDialect struct{}

func (d *SQLiteDialect) Name() string       { return "sqlite" }
func (d *SQLiteDialect) DriverName() string  { return "sqlite" }

func (d *SQLiteDialect) Placeholder(index int) string {
	return fmt.Sprintf("?%d", index)
}

func (d *SQLiteDialect) NewParamBuilder() ParamBuilder {
	return &sqliteParamBuilder{}
}

func (d *SQLiteDialect) NowExpr() string      { return "datetime('now')" }
func (d *SQLiteDialect) UUIDDefault() string   { return "" }
func (d *SQLiteDialect) NeedsBoolFix() bool    { return true }
func (d *SQLiteDialect) SupportsPercentile() bool { return false }

func (d *SQLiteDialect) ColumnType(fieldType string, precision int) string {
	switch fieldType {
	case "string", "text":
		return "TEXT"
	case "int", "integer":
		return "INTEGER"
	case "bigint":
		return "INTEGER"
	case "float":
		return "REAL"
	case "decimal":
		return "REAL"
	case "boolean":
		return "INTEGER"
	case "uuid":
		return "TEXT"
	case "timestamp":
		return "TEXT"
	case "date":
		return "TEXT"
	case "json", "file":
		return "TEXT"
	default:
		return "TEXT"
	}
}

func (d *SQLiteDialect) SystemTablesSQL() string {
	return sqliteSystemTablesSQL
}

func (d *SQLiteDialect) PlatformTablesSQL() string {
	return sqlitePlatformTablesSQL
}

func (d *SQLiteDialect) TableExists(ctx context.Context, db *sql.DB, tableName string) (bool, error) {
	var name string
	err := db.QueryRowContext(ctx,
		"SELECT name FROM sqlite_master WHERE type='table' AND name=?1",
		tableName,
	).Scan(&name)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func (d *SQLiteDialect) GetColumns(ctx context.Context, db *sql.DB, tableName string) (map[string]string, error) {
	rows, err := db.QueryContext(ctx, fmt.Sprintf("PRAGMA table_info(%s)", tableName))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols := make(map[string]string)
	for rows.Next() {
		var cid int
		var name, colType string
		var notNull int
		var dfltValue any
		var pk int
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dfltValue, &pk); err != nil {
			return nil, err
		}
		cols[name] = colType
	}
	return cols, rows.Err()
}

func (d *SQLiteDialect) SoftDeleteIndexSQL(table string) string {
	// SQLite supports partial indexes (3.8.0+)
	return fmt.Sprintf("CREATE INDEX IF NOT EXISTS idx_%s_deleted_at ON %s (deleted_at) WHERE deleted_at IS NULL", table, table)
}

func (d *SQLiteDialect) InExpr(field string, pb ParamBuilder, values []any) string {
	if len(values) == 0 {
		return "1=0" // always false
	}
	phs := make([]string, len(values))
	for i, v := range values {
		phs[i] = pb.Add(v)
	}
	return fmt.Sprintf("%s IN (%s)", field, strings.Join(phs, ", "))
}

func (d *SQLiteDialect) NotInExpr(field string, pb ParamBuilder, values []any) string {
	if len(values) == 0 {
		return "1=1" // always true
	}
	phs := make([]string, len(values))
	for i, v := range values {
		phs[i] = pb.Add(v)
	}
	return fmt.Sprintf("%s NOT IN (%s)", field, strings.Join(phs, ", "))
}

func (d *SQLiteDialect) IntervalDeleteExpr(createdAtCol string, pb ParamBuilder, days string) string {
	ph := pb.Add(days)
	return fmt.Sprintf("%s < datetime('now', '-' || %s || ' days')", createdAtCol, ph)
}

func (d *SQLiteDialect) ArrayParam(values []string) any {
	if values == nil {
		return "[]"
	}
	b, _ := json.Marshal(values)
	return string(b)
}

func (d *SQLiteDialect) ScanArray(src any) ([]string, error) {
	if src == nil {
		return []string{}, nil
	}
	var s string
	switch v := src.(type) {
	case string:
		s = v
	case []byte:
		s = string(v)
	default:
		return []string{}, nil
	}
	s = strings.TrimSpace(s)
	if s == "" || s == "[]" {
		return []string{}, nil
	}
	var result []string
	if err := json.Unmarshal([]byte(s), &result); err != nil {
		return []string{}, fmt.Errorf("scan array: %w", err)
	}
	return result, nil
}

func (d *SQLiteDialect) FilterCountExpr(condition string) string {
	return fmt.Sprintf("SUM(CASE WHEN %s THEN 1 ELSE 0 END)", condition)
}

func (d *SQLiteDialect) SyncCommitOff() string { return "" }

func (d *SQLiteDialect) PercentileExpr(_ float64, _ string) string { return "" }

func (d *SQLiteDialect) CreateDatabase(_ context.Context, _ *sql.DB, name string, dataDir string) error {
	if dataDir == "" {
		dataDir = "./data"
	}
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}
	dbPath := filepath.Join(dataDir, name+".db")
	// Create the file if it doesn't exist
	f, err := os.OpenFile(dbPath, os.O_CREATE|os.O_RDONLY, 0644)
	if err != nil {
		return fmt.Errorf("create database file: %w", err)
	}
	return f.Close()
}

func (d *SQLiteDialect) DropDatabase(_ context.Context, _ *sql.DB, name string, dataDir string) error {
	if dataDir == "" {
		dataDir = "./data"
	}
	dbPath := filepath.Join(dataDir, name+".db")
	// Remove the main db file and associated WAL/SHM files
	os.Remove(dbPath + "-wal")
	os.Remove(dbPath + "-shm")
	if err := os.Remove(dbPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove database file: %w", err)
	}
	return nil
}

func (d *SQLiteDialect) MapError(err error) error {
	if err == nil {
		return nil
	}
	errStr := err.Error()
	if strings.Contains(errStr, "UNIQUE constraint failed") || strings.Contains(errStr, "constraint failed: UNIQUE") {
		return fmt.Errorf("%w: %w", ErrUniqueViolation, err)
	}
	return err
}

// --- SQLite DDL ---

const sqliteSystemTablesSQL = `
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
`

const sqlitePlatformTablesSQL = `
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
`

// Compile-time check
var _ Dialect = (*SQLiteDialect)(nil)
