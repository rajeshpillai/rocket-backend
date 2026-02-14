package store

import (
	"context"
	"fmt"
	"log"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// Bootstrap creates all system tables and seeds the admin user.
func (s *Store) Bootstrap(ctx context.Context) error {
	ddl := s.Dialect.SystemTablesSQL()
	if _, err := s.DB.ExecContext(ctx, ddl); err != nil {
		return fmt.Errorf("bootstrap system tables: %w", err)
	}
	if err := s.seedAdminUser(ctx); err != nil {
		return fmt.Errorf("seed admin user: %w", err)
	}
	return nil
}

func (s *Store) seedAdminUser(ctx context.Context) error {
	var count int
	err := s.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM _users").Scan(&count)
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
	rolesParam := s.Dialect.ArrayParam([]string{"admin"})

	if s.Dialect.Name() == "sqlite" {
		// SQLite: generate UUID in Go, roles as JSON string
		id := uuid.New().String()
		sqlStr := fmt.Sprintf(
			"INSERT INTO _users (id, email, password_hash, roles) VALUES (%s, %s, %s, %s)",
			pb.Add(id), pb.Add("admin@localhost"), pb.Add(hash), pb.Add(rolesParam),
		)
		_, err = s.DB.ExecContext(ctx, sqlStr, pb.Params()...)
	} else {
		// PostgreSQL: let gen_random_uuid() handle the ID
		sqlStr := fmt.Sprintf(
			"INSERT INTO _users (email, password_hash, roles) VALUES (%s, %s, %s)",
			pb.Add("admin@localhost"), pb.Add(hash), pb.Add(rolesParam),
		)
		_, err = s.DB.ExecContext(ctx, sqlStr, pb.Params()...)
	}

	if err != nil {
		return err
	}

	log.Println("WARNING: Default admin user created (admin@localhost / changeme) — change the password immediately.")
	return nil
}
