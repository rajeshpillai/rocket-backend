package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"  // Register pgx as database/sql driver
	_ "modernc.org/sqlite"               // Register sqlite as database/sql driver

	"rocket-backend/internal/config"
)

var ErrNotFound = errors.New("not found")
var ErrUniqueViolation = errors.New("unique constraint violation")

// Querier is implemented by both *sql.DB and *sql.Tx.
type Querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// Store wraps a database connection and dialect.
type Store struct {
	DB      *sql.DB
	Dialect Dialect
	driver  string
	dataDir string // for SQLite: directory holding .db files
}

// New creates a Store from config.
func New(ctx context.Context, cfg config.DatabaseConfig) (*Store, error) {
	driver := cfg.Driver
	if driver == "" {
		driver = "postgres"
	}

	dialect := NewDialect(driver)
	driverName := dialect.DriverName()
	dsn := cfg.DSN()

	db, err := sql.Open(driverName, dsn)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	if driver == "postgres" {
		if cfg.PoolSize > 0 {
			db.SetMaxOpenConns(cfg.PoolSize)
		}
	} else if driver == "sqlite" {
		// SQLite: single writer, WAL mode for concurrent reads
		db.SetMaxOpenConns(1)
		if _, err := db.ExecContext(ctx, "PRAGMA journal_mode=WAL"); err != nil {
			db.Close()
			return nil, fmt.Errorf("enable WAL: %w", err)
		}
		if _, err := db.ExecContext(ctx, "PRAGMA foreign_keys=ON"); err != nil {
			db.Close()
			return nil, fmt.Errorf("enable foreign keys: %w", err)
		}
	}

	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}

	return &Store{
		DB:      db,
		Dialect: dialect,
		driver:  driver,
		dataDir: cfg.Path,
	}, nil
}

// NewWithPoolSize connects to a database using the given config but overrides pool size.
func NewWithPoolSize(ctx context.Context, cfg config.DatabaseConfig, poolSize int) (*Store, error) {
	override := cfg
	override.PoolSize = poolSize
	return New(ctx, override)
}

// ConnStringForDB returns a config pointing to a different database name.
func ConnStringForDB(cfg config.DatabaseConfig, dbName string) config.DatabaseConfig {
	c := cfg
	c.Name = dbName
	return c
}

// DataDir returns the data directory path (for SQLite database file management).
func (s *Store) DataDir() string {
	return s.dataDir
}

// Close closes the database connection.
func (s *Store) Close() {
	s.DB.Close()
}

// BeginTx starts a new transaction.
func (s *Store) BeginTx(ctx context.Context) (*sql.Tx, error) {
	return s.DB.BeginTx(ctx, nil)
}

// QueryRows executes a query and returns results as []map[string]any.
func QueryRows(ctx context.Context, q Querier, sqlStr string, args ...any) ([]map[string]any, error) {
	rows, err := q.QueryContext(ctx, sqlStr, args...)
	if err != nil {
		return nil, fmt.Errorf("query: %w", err)
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("get columns: %w", err)
	}

	var results []map[string]any
	for rows.Next() {
		values := make([]any, len(columns))
		ptrs := make([]any, len(columns))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}

		row := make(map[string]any, len(columns))
		for i, col := range columns {
			row[col] = normalizeValue(values[i])
		}
		results = append(results, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows iteration: %w", err)
	}
	return results, nil
}

// QueryRow executes a query and returns a single row as map[string]any.
func QueryRow(ctx context.Context, q Querier, sqlStr string, args ...any) (map[string]any, error) {
	rows, err := QueryRows(ctx, q, sqlStr, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return rows[0], nil
}

// Exec executes a statement and returns the number of rows affected.
func Exec(ctx context.Context, q Querier, sqlStr string, args ...any) (int64, error) {
	result, err := q.ExecContext(ctx, sqlStr, args...)
	if err != nil {
		return 0, fmt.Errorf("exec: %w", err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("rows affected: %w", err)
	}
	return n, nil
}

// MapError maps a database error to a well-known sentinel error using the store's dialect.
func MapError(dialect Dialect, err error) error {
	if err == nil {
		return nil
	}
	return dialect.MapError(err)
}

// normalizeValue converts database-specific types to JSON-serializable Go types.
func normalizeValue(v any) any {
	if v == nil {
		return nil
	}
	switch val := v.(type) {
	case []byte:
		// database/sql often returns []byte for TEXT columns
		s := string(val)
		// Try parsing as ISO8601 timestamp for SQLite text timestamps
		if t, err := time.Parse("2006-01-02 15:04:05", s); err == nil {
			return t
		}
		if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
			return t
		}
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			return t
		}
		return s
	case int64:
		// For SQLite, COUNT(*) and similar come as int64
		return val
	case float64:
		return val
	case bool:
		return val
	case time.Time:
		return val
	case string:
		return val
	default:
		return val
	}
}

// NormalizeBooleans converts integer 0/1 values to bool for specified fields.
// This is needed for SQLite where BOOLEAN columns are stored as INTEGER.
func NormalizeBooleans(rows []map[string]any, boolFields []string) {
	if len(boolFields) == 0 || len(rows) == 0 {
		return
	}
	boolSet := make(map[string]bool, len(boolFields))
	for _, f := range boolFields {
		boolSet[f] = true
	}
	for _, row := range rows {
		for k, v := range row {
			if !boolSet[k] {
				continue
			}
			switch val := v.(type) {
			case int64:
				row[k] = val != 0
			case int:
				row[k] = val != 0
			case float64:
				row[k] = val != 0
			}
		}
	}
}

// CreateDatabase creates a new database.
func CreateDatabase(ctx context.Context, s *Store, dbName string) error {
	return s.Dialect.CreateDatabase(ctx, s.DB, dbName, s.dataDir)
}

// DropDatabase drops a database.
func DropDatabase(ctx context.Context, s *Store, dbName string) error {
	return s.Dialect.DropDatabase(ctx, s.DB, dbName, s.dataDir)
}

func init() {
	// Ensure drivers are registered
	log.SetFlags(log.LstdFlags | log.Lshortfile)
}
