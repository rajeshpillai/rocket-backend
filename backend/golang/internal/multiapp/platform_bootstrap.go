package multiapp

import (
	"context"
	"fmt"
	"log"

	"golang.org/x/crypto/bcrypt"

	"rocket-backend/internal/store"
)

// PlatformBootstrap creates the management tables (_apps, _platform_users, _platform_refresh_tokens)
// and seeds a default platform admin user.
func PlatformBootstrap(ctx context.Context, s *store.Store) error {
	if _, err := s.DB.ExecContext(ctx, s.Dialect.PlatformTablesSQL()); err != nil {
		return fmt.Errorf("bootstrap platform tables: %w", err)
	}
	if err := migratePlatformTables(ctx, s); err != nil {
		return fmt.Errorf("migrate platform tables: %w", err)
	}
	if err := seedPlatformAdmin(ctx, s); err != nil {
		return fmt.Errorf("seed platform admin: %w", err)
	}
	return nil
}

// migratePlatformTables adds columns that were introduced after the initial schema.
func migratePlatformTables(ctx context.Context, s *store.Store) error {
	cols, err := s.Dialect.GetColumns(ctx, s.DB, "_apps")
	if err != nil {
		return nil // table may not exist yet, CREATE TABLE IF NOT EXISTS handles it
	}
	if _, ok := cols["db_driver"]; !ok {
		defaultDriver := s.Dialect.Name()
		_, err := s.DB.ExecContext(ctx,
			fmt.Sprintf("ALTER TABLE _apps ADD COLUMN db_driver TEXT NOT NULL DEFAULT '%s'", defaultDriver))
		if err != nil {
			return fmt.Errorf("add db_driver column: %w", err)
		}
		log.Printf("Migrated _apps: added db_driver column (default: %s)", defaultDriver)
	}
	return nil
}

func seedPlatformAdmin(ctx context.Context, s *store.Store) error {
	var count int
	err := s.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM _platform_users").Scan(&count)
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
	hash := string(hashBytes)

	pb := s.Dialect.NewParamBuilder()
	rolesParam := s.Dialect.ArrayParam([]string{"platform_admin"})
	if s.Dialect.UUIDDefault() == "" {
		// SQLite: generate UUID in Go since there's no gen_random_uuid()
		id := store.GenerateUUID()
		_, err = s.DB.ExecContext(ctx,
			fmt.Sprintf("INSERT INTO _platform_users (id, email, password_hash, roles) VALUES (%s, %s, %s, %s)",
				pb.Add(id), pb.Add("platform@localhost"), pb.Add(hash), pb.Add(rolesParam)),
			pb.Params()...)
	} else {
		_, err = s.DB.ExecContext(ctx,
			fmt.Sprintf("INSERT INTO _platform_users (email, password_hash, roles) VALUES (%s, %s, %s)",
				pb.Add("platform@localhost"), pb.Add(hash), pb.Add(rolesParam)),
			pb.Params()...)
	}
	if err != nil {
		return err
	}

	log.Println("WARNING: Default platform admin created (platform@localhost / changeme) — change the password immediately.")
	return nil
}
