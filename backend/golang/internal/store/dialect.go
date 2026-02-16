package store

import (
	"context"
	"database/sql"
	"fmt"
)

// Dialect abstracts database-specific SQL generation and behavior.
type Dialect interface {
	// Name returns "postgres" or "sqlite".
	Name() string

	// DriverName returns the database/sql driver name ("pgx" or "sqlite").
	DriverName() string

	// Placeholder returns the parameter placeholder for the given 1-based index.
	Placeholder(index int) string

	// NewParamBuilder creates a dialect-aware parameter builder.
	NewParamBuilder() ParamBuilder

	// NowExpr returns the SQL expression for the current timestamp.
	NowExpr() string

	// UUIDDefault returns the DDL DEFAULT clause for auto-generated UUIDs,
	// or empty string if UUIDs must be generated in application code.
	UUIDDefault() string

	// ColumnType maps a metadata field type to the database DDL type.
	ColumnType(fieldType string, precision int) string

	// SystemTablesSQL returns the DDL for all per-app system tables.
	SystemTablesSQL() string

	// PlatformTablesSQL returns the DDL for platform management tables.
	PlatformTablesSQL() string

	// TableExists checks whether a table exists.
	TableExists(ctx context.Context, db *sql.DB, tableName string) (bool, error)

	// GetColumns returns existing column names and types for a table.
	GetColumns(ctx context.Context, db *sql.DB, tableName string) (map[string]string, error)

	// SoftDeleteIndexSQL returns the CREATE INDEX statement for soft-delete filtering.
	SoftDeleteIndexSQL(table string) string

	// InExpr builds a SQL expression for the IN operator.
	// PostgreSQL: "field = ANY($n)" with single array param.
	// SQLite: "field IN (?n, ?n+1, ...)" expanding the slice.
	// Returns the SQL fragment and the values to add as params.
	InExpr(field string, pb ParamBuilder, values []any) string

	// NotInExpr builds a SQL expression for the NOT IN operator.
	NotInExpr(field string, pb ParamBuilder, values []any) string

	// IntervalDeleteExpr returns SQL for deleting rows older than N days.
	IntervalDeleteExpr(createdAtCol string, pb ParamBuilder, days string) string

	// ArrayParam encodes a string slice for storage.
	// PostgreSQL: returns the slice as-is (pgx handles TEXT[]).
	// SQLite: JSON-encodes to string.
	ArrayParam(values []string) any

	// ScanArray decodes a TEXT[] (PostgreSQL) or JSON string (SQLite) into []string.
	ScanArray(src any) ([]string, error)

	// FilterCountExpr returns SQL for conditional counting.
	// PostgreSQL: "COUNT(*) FILTER (WHERE condition)"
	// SQLite: "SUM(CASE WHEN condition THEN 1 ELSE 0 END)"
	FilterCountExpr(condition string) string

	// SyncCommitOff returns SQL to disable synchronous commit in a transaction,
	// or empty string if not applicable.
	SyncCommitOff() string

	// SupportsPercentile returns true if the database supports percentile_cont.
	SupportsPercentile() bool

	// PercentileExpr returns SQL for percentile calculation, or empty string.
	PercentileExpr(pct float64, orderCol string) string

	// CreateDatabase creates a new database (PostgreSQL) or database file (SQLite).
	CreateDatabase(ctx context.Context, db *sql.DB, name string, dataDir string) error

	// DropDatabase drops a database (PostgreSQL) or deletes the file (SQLite).
	DropDatabase(ctx context.Context, db *sql.DB, name string, dataDir string) error

	// MapError inspects a driver error and returns a well-known sentinel error if applicable.
	MapError(err error) error

	// NeedsBoolFix returns true if boolean columns come back as integers (SQLite).
	NeedsBoolFix() bool
}

// ParamBuilder accumulates query parameters and generates dialect-specific placeholders.
type ParamBuilder interface {
	// Add appends a value and returns the placeholder string.
	Add(v any) string

	// Params returns all accumulated parameter values.
	Params() []any

	// Count returns the number of parameters added so far.
	Count() int
}

// NewDialect creates a Dialect for the given driver name ("postgres" or "sqlite").
func NewDialect(driver string) Dialect {
	switch driver {
	case "sqlite":
		return &SQLiteDialect{}
	default:
		return &PostgresDialect{}
	}
}

// --- PostgreSQL ParamBuilder ---

type pgParamBuilder struct {
	params []any
	n      int
}

func (p *pgParamBuilder) Add(v any) string {
	p.n++
	p.params = append(p.params, v)
	return fmt.Sprintf("$%d", p.n)
}

func (p *pgParamBuilder) Params() []any { return p.params }
func (p *pgParamBuilder) Count() int    { return p.n }

// --- SQLite ParamBuilder ---

type sqliteParamBuilder struct {
	params []any
	n      int
}

func (p *sqliteParamBuilder) Add(v any) string {
	p.n++
	p.params = append(p.params, v)
	return fmt.Sprintf("?%d", p.n)
}

func (p *sqliteParamBuilder) Params() []any { return p.params }
func (p *sqliteParamBuilder) Count() int    { return p.n }
