package store

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestMapError_PG_UniqueViolation(t *testing.T) {
	dialect := &PostgresDialect{}
	pgErr := &pgconn.PgError{
		Code:           "23505",
		Message:        "duplicate key value violates unique constraint \"idx_users_email\"",
		ConstraintName: "idx_users_email",
		Detail:         "Key (email)=(dup@test.com) already exists.",
	}
	wrapped := fmt.Errorf("exec: %w", pgErr)

	mapped := MapError(dialect, wrapped)

	if !errors.Is(mapped, ErrUniqueViolation) {
		t.Fatalf("expected ErrUniqueViolation, got: %v", mapped)
	}

	// Original pgconn.PgError should still be extractable
	var extracted *pgconn.PgError
	if !errors.As(mapped, &extracted) {
		t.Fatal("expected pgconn.PgError to still be extractable via errors.As")
	}
	if extracted.ConstraintName != "idx_users_email" {
		t.Fatalf("expected constraint name 'idx_users_email', got: %s", extracted.ConstraintName)
	}
}

func TestMapError_PG_OtherError(t *testing.T) {
	dialect := &PostgresDialect{}
	err := fmt.Errorf("some other error")
	mapped := MapError(dialect, err)
	if mapped != err {
		t.Fatalf("expected same error back, got: %v", mapped)
	}
}

func TestMapError_PG_Nil(t *testing.T) {
	dialect := &PostgresDialect{}
	mapped := MapError(dialect, nil)
	if mapped != nil {
		t.Fatalf("expected nil, got: %v", mapped)
	}
}
