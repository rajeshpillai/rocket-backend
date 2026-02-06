package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"rocket-backend/internal/config"
)

var ErrNotFound = errors.New("not found")

// Querier is implemented by both *pgxpool.Pool and pgx.Tx.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

type Store struct {
	Pool *pgxpool.Pool
}

func New(ctx context.Context, cfg config.DatabaseConfig) (*Store, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.ConnString())
	if err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	if cfg.PoolSize > 0 {
		poolCfg.MaxConns = int32(cfg.PoolSize)
	}

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}

	return &Store{Pool: pool}, nil
}

func (s *Store) Close() {
	s.Pool.Close()
}

func (s *Store) BeginTx(ctx context.Context) (pgx.Tx, error) {
	return s.Pool.Begin(ctx)
}

// QueryRows executes a query and returns results as []map[string]any.
func QueryRows(ctx context.Context, q Querier, sql string, args ...any) ([]map[string]any, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("query: %w", err)
	}
	defer rows.Close()

	fieldDescs := rows.FieldDescriptions()
	var results []map[string]any

	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, fmt.Errorf("scan values: %w", err)
		}
		row := make(map[string]any, len(fieldDescs))
		for i, fd := range fieldDescs {
			row[fd.Name] = normalizeValue(values[i])
		}
		results = append(results, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows iteration: %w", err)
	}
	return results, nil
}

// QueryRow executes a query and returns a single row as map[string]any.
func QueryRow(ctx context.Context, q Querier, sql string, args ...any) (map[string]any, error) {
	rows, err := QueryRows(ctx, q, sql, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return rows[0], nil
}

// Exec executes a statement and returns the number of rows affected.
func Exec(ctx context.Context, q Querier, sql string, args ...any) (int64, error) {
	tag, err := q.Exec(ctx, sql, args...)
	if err != nil {
		return 0, fmt.Errorf("exec: %w", err)
	}
	return tag.RowsAffected(), nil
}

// normalizeValue converts pgx-specific types to JSON-serializable Go types.
func normalizeValue(v any) any {
	if v == nil {
		return nil
	}
	switch val := v.(type) {
	case [16]byte:
		// UUID as raw bytes -> format as string
		return fmt.Sprintf("%x-%x-%x-%x-%x", val[0:4], val[4:6], val[6:8], val[8:10], val[10:16])
	case pgtype.Numeric:
		f, err := val.Float64Value()
		if err == nil && f.Valid {
			return f.Float64
		}
		return 0
	case pgtype.UUID:
		if val.Valid {
			b := val.Bytes
			return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
		}
		return nil
	default:
		return v
	}
}
