package multiapp

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

const platformTablesSQL = `
CREATE TABLE IF NOT EXISTS _apps (
    name         TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    db_name      TEXT NOT NULL UNIQUE,
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

// PlatformBootstrap creates the management tables (_apps, _platform_users, _platform_refresh_tokens)
// and seeds a default platform admin user.
func PlatformBootstrap(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, platformTablesSQL); err != nil {
		return fmt.Errorf("bootstrap platform tables: %w", err)
	}
	if err := seedPlatformAdmin(ctx, pool); err != nil {
		return fmt.Errorf("seed platform admin: %w", err)
	}
	return nil
}

func seedPlatformAdmin(ctx context.Context, pool *pgxpool.Pool) error {
	var count int
	err := pool.QueryRow(ctx, "SELECT COUNT(*) FROM _platform_users").Scan(&count)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	hashBytes, err := bcrypt.GenerateFromPassword([]byte("changeme"), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx,
		`INSERT INTO _platform_users (email, password_hash, roles) VALUES ($1, $2, $3)`,
		"platform@localhost", string(hashBytes), []string{"platform_admin"},
	)
	if err != nil {
		return err
	}

	log.Println("WARNING: Default platform admin created (platform@localhost / changeme) — change the password immediately.")
	return nil
}
