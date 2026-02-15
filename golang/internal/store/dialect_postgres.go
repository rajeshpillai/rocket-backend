package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// PostgresDialect implements Dialect for PostgreSQL via pgx/stdlib.
type PostgresDialect struct{}

func (d *PostgresDialect) Name() string       { return "postgres" }
func (d *PostgresDialect) DriverName() string  { return "pgx" }

func (d *PostgresDialect) Placeholder(index int) string {
	return fmt.Sprintf("$%d", index)
}

func (d *PostgresDialect) NewParamBuilder() ParamBuilder {
	return &pgParamBuilder{}
}

func (d *PostgresDialect) NowExpr() string      { return "NOW()" }
func (d *PostgresDialect) UUIDDefault() string   { return "DEFAULT gen_random_uuid()" }
func (d *PostgresDialect) NeedsBoolFix() bool    { return false }
func (d *PostgresDialect) SupportsPercentile() bool { return true }

func (d *PostgresDialect) ColumnType(fieldType string, precision int) string {
	switch fieldType {
	case "string", "text":
		return "TEXT"
	case "int", "integer":
		return "INTEGER"
	case "bigint":
		return "BIGINT"
	case "float":
		return "DOUBLE PRECISION"
	case "decimal":
		if precision > 0 {
			return fmt.Sprintf("NUMERIC(18,%d)", precision)
		}
		return "NUMERIC"
	case "boolean":
		return "BOOLEAN"
	case "uuid":
		return "UUID"
	case "timestamp":
		return "TIMESTAMPTZ"
	case "date":
		return "DATE"
	case "json", "file":
		return "JSONB"
	default:
		return "TEXT"
	}
}

func (d *PostgresDialect) SystemTablesSQL() string {
	return pgSystemTablesSQL
}

func (d *PostgresDialect) PlatformTablesSQL() string {
	return pgPlatformTablesSQL
}

func (d *PostgresDialect) TableExists(ctx context.Context, db *sql.DB, tableName string) (bool, error) {
	var exists bool
	err := db.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public')`,
		tableName,
	).Scan(&exists)
	return exists, err
}

func (d *PostgresDialect) GetColumns(ctx context.Context, db *sql.DB, tableName string) (map[string]string, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
		tableName,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols := make(map[string]string)
	for rows.Next() {
		var name, dataType string
		if err := rows.Scan(&name, &dataType); err != nil {
			return nil, err
		}
		cols[name] = dataType
	}
	return cols, rows.Err()
}

func (d *PostgresDialect) SoftDeleteIndexSQL(table string) string {
	return fmt.Sprintf("CREATE INDEX IF NOT EXISTS idx_%s_deleted_at ON %s (deleted_at) WHERE deleted_at IS NULL", table, table)
}

func (d *PostgresDialect) InExpr(field string, pb ParamBuilder, values []any) string {
	ph := pb.Add(values)
	return fmt.Sprintf("%s = ANY(%s)", field, ph)
}

func (d *PostgresDialect) NotInExpr(field string, pb ParamBuilder, values []any) string {
	ph := pb.Add(values)
	return fmt.Sprintf("%s != ALL(%s)", field, ph)
}

func (d *PostgresDialect) IntervalDeleteExpr(createdAtCol string, pb ParamBuilder, days string) string {
	ph := pb.Add(days)
	return fmt.Sprintf("%s < now() - (%s || ' days')::interval", createdAtCol, ph)
}

func (d *PostgresDialect) ArrayParam(values []string) any {
	return values
}

func (d *PostgresDialect) ScanArray(src any) ([]string, error) {
	if src == nil {
		return []string{}, nil
	}
	switch v := src.(type) {
	case []string:
		return v, nil
	case []any:
		result := make([]string, len(v))
		for i, item := range v {
			result[i] = fmt.Sprintf("%v", item)
		}
		return result, nil
	case []byte:
		// pgx/stdlib may return TEXT[] as a string like {admin,user}
		return parsePgArray(string(v))
	case string:
		return parsePgArray(v)
	default:
		return []string{}, nil
	}
}

// parsePgArray parses a PostgreSQL array literal like {admin,user} into []string.
func parsePgArray(s string) ([]string, error) {
	s = strings.TrimSpace(s)
	if s == "" || s == "{}" {
		return []string{}, nil
	}
	// Try JSON first (in case it's a JSON array)
	if strings.HasPrefix(s, "[") {
		var result []string
		if err := json.Unmarshal([]byte(s), &result); err == nil {
			return result, nil
		}
	}
	// Parse PostgreSQL array literal: {val1,val2,...}
	if strings.HasPrefix(s, "{") && strings.HasSuffix(s, "}") {
		inner := s[1 : len(s)-1]
		if inner == "" {
			return []string{}, nil
		}
		parts := strings.Split(inner, ",")
		result := make([]string, len(parts))
		for i, p := range parts {
			result[i] = strings.Trim(strings.TrimSpace(p), `"`)
		}
		return result, nil
	}
	return []string{s}, nil
}

func (d *PostgresDialect) FilterCountExpr(condition string) string {
	return fmt.Sprintf("COUNT(*) FILTER (WHERE %s)", condition)
}

func (d *PostgresDialect) SyncCommitOff() string {
	return "SET LOCAL synchronous_commit = off"
}

func (d *PostgresDialect) PercentileExpr(pct float64, orderCol string) string {
	return fmt.Sprintf("percentile_cont(%g) WITHIN GROUP (ORDER BY %s)", pct, orderCol)
}

func (d *PostgresDialect) CreateDatabase(ctx context.Context, db *sql.DB, name string, _ string) error {
	if !isValidDBName(name) {
		return fmt.Errorf("invalid database name: %s", name)
	}
	_, err := db.ExecContext(ctx, fmt.Sprintf("CREATE DATABASE %s", name))
	return err
}

func (d *PostgresDialect) DropDatabase(ctx context.Context, db *sql.DB, name string, _ string) error {
	if !isValidDBName(name) {
		return fmt.Errorf("invalid database name: %s", name)
	}
	_, err := db.ExecContext(ctx, fmt.Sprintf("DROP DATABASE IF EXISTS %s", name))
	return err
}

func (d *PostgresDialect) MapError(err error) error {
	if err == nil {
		return nil
	}
	// Check for unique constraint violation via error string
	// With pgx/stdlib, the underlying error message includes the PG code
	errStr := err.Error()
	if strings.Contains(errStr, "23505") || strings.Contains(errStr, "unique constraint") || strings.Contains(errStr, "duplicate key") {
		return fmt.Errorf("%w: %w", ErrUniqueViolation, err)
	}
	return err
}

// isValidDBName checks that a database name contains only safe characters.
func isValidDBName(name string) bool {
	if len(name) == 0 || len(name) > 63 {
		return false
	}
	for _, c := range name {
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_') {
			return false
		}
	}
	return true
}

// --- PostgreSQL DDL ---

const pgSystemTablesSQL = `
CREATE TABLE IF NOT EXISTS _entities (
    name        TEXT PRIMARY KEY,
    table_name  TEXT NOT NULL UNIQUE,
    definition  JSONB NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _relations (
    name        TEXT PRIMARY KEY,
    source      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
    target      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
    definition  JSONB NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

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
);

CREATE TABLE IF NOT EXISTS _state_machines (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
    field       TEXT NOT NULL,
    definition  JSONB NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _workflows (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,
    trigger     JSONB NOT NULL,
    context     JSONB NOT NULL DEFAULT '{}',
    steps       JSONB NOT NULL DEFAULT '[]',
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

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
);

CREATE TABLE IF NOT EXISTS _users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    roles         TEXT[] DEFAULT '{}',
    active        BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES _users(id) ON DELETE CASCADE,
    token      UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON _refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON _refresh_tokens(expires_at);

CREATE TABLE IF NOT EXISTS _permissions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity     TEXT NOT NULL,
    action     TEXT NOT NULL,
    roles      TEXT[] NOT NULL DEFAULT '{}',
    conditions JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

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
);

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
);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON _webhook_logs(status);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_retry ON _webhook_logs(next_retry_at) WHERE status = 'retrying';

CREATE TABLE IF NOT EXISTS _files (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename      TEXT NOT NULL,
    storage_path  TEXT NOT NULL,
    mime_type     TEXT NOT NULL DEFAULT 'application/octet-stream',
    size          BIGINT NOT NULL DEFAULT 0,
    uploaded_by   UUID,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _ui_configs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity     TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
    scope      TEXT NOT NULL DEFAULT 'default',
    config     JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(entity, scope)
);

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
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_trace ON _events (trace_id);
CREATE INDEX IF NOT EXISTS idx_events_entity_created ON _events (entity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_created ON _events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_source ON _events (event_type, source);

CREATE TABLE IF NOT EXISTS _invites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT NOT NULL,
    roles       TEXT[] DEFAULT '{}',
    token       TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    invited_by  UUID,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invites_token ON _invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_email ON _invites(email);
`

const pgPlatformTablesSQL = `
CREATE TABLE IF NOT EXISTS _apps (
    name         TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    db_name      TEXT NOT NULL UNIQUE,
    db_driver    TEXT NOT NULL DEFAULT 'postgres',
    jwt_secret   TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'active',
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _platform_users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    roles         TEXT[] DEFAULT '{platform_admin}',
    active        BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _platform_refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES _platform_users(id) ON DELETE CASCADE,
    token      UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_refresh_tokens_token ON _platform_refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_platform_refresh_tokens_expires ON _platform_refresh_tokens(expires_at);
`

// Compile-time check
var _ Dialect = (*PostgresDialect)(nil)

// Compile-time check for error sentinel
var _ = errors.New // ensure errors import is used
