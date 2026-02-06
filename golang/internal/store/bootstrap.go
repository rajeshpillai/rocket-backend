package store

import (
	"context"
	"fmt"
)

const systemTablesSQL = `
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
`

func (s *Store) Bootstrap(ctx context.Context) error {
	if _, err := s.Pool.Exec(ctx, systemTablesSQL); err != nil {
		return fmt.Errorf("bootstrap system tables: %w", err)
	}
	return nil
}
