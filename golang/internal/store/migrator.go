package store

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"rocket-backend/internal/metadata"
)

type Migrator struct {
	store *Store
}

func NewMigrator(store *Store) *Migrator {
	return &Migrator{store: store}
}

// Migrate ensures the database table matches the entity metadata.
// Creates the table if it doesn't exist, or adds missing columns.
func (m *Migrator) Migrate(ctx context.Context, entity *metadata.Entity) error {
	exists, err := m.store.Dialect.TableExists(ctx, m.store.DB, entity.Table)
	if err != nil {
		return fmt.Errorf("check table exists: %w", err)
	}

	if !exists {
		return m.createTable(ctx, entity)
	}

	return m.alterTable(ctx, entity)
}

// MigrateJoinTable creates a join table for a many-to-many relation if it doesn't exist.
func (m *Migrator) MigrateJoinTable(ctx context.Context, rel *metadata.Relation, sourceEntity, targetEntity *metadata.Entity) error {
	exists, err := m.store.Dialect.TableExists(ctx, m.store.DB, rel.JoinTable)
	if err != nil {
		return fmt.Errorf("check join table exists: %w", err)
	}
	if exists {
		return nil
	}

	sourceField := sourceEntity.GetField(rel.SourceKey)
	targetField := targetEntity.GetField(targetEntity.PrimaryKey.Field)
	if sourceField == nil || targetField == nil {
		return fmt.Errorf("cannot resolve key types for join table %s", rel.JoinTable)
	}

	sqlStr := fmt.Sprintf(
		`CREATE TABLE %s (
			%s %s NOT NULL,
			%s %s NOT NULL,
			PRIMARY KEY (%s, %s)
		)`,
		rel.JoinTable,
		rel.SourceJoinKey, m.store.Dialect.ColumnType(sourceField.Type, sourceField.Precision),
		rel.TargetJoinKey, m.store.Dialect.ColumnType(targetField.Type, targetField.Precision),
		rel.SourceJoinKey, rel.TargetJoinKey,
	)

	if _, err := m.store.DB.ExecContext(ctx, sqlStr); err != nil {
		return fmt.Errorf("create join table %s: %w", rel.JoinTable, err)
	}
	return nil
}

func (m *Migrator) createTable(ctx context.Context, entity *metadata.Entity) error {
	var cols []string
	for _, f := range entity.Fields {
		col := m.buildColumnDef(entity, &f)
		cols = append(cols, col)
	}

	// Add deleted_at if soft delete is enabled and not already in fields
	if entity.SoftDelete && entity.GetField("deleted_at") == nil {
		cols = append(cols, "deleted_at "+m.store.Dialect.ColumnType("timestamp", 0))
	}

	sqlStr := fmt.Sprintf("CREATE TABLE %s (\n  %s\n)", entity.Table, strings.Join(cols, ",\n  "))

	if _, err := m.store.DB.ExecContext(ctx, sqlStr); err != nil {
		return fmt.Errorf("create table %s: %w", entity.Table, err)
	}

	// Create indexes
	if err := m.createIndexes(ctx, entity); err != nil {
		return fmt.Errorf("create indexes for %s: %w", entity.Table, err)
	}

	return nil
}

func (m *Migrator) alterTable(ctx context.Context, entity *metadata.Entity) error {
	existing, err := m.store.Dialect.GetColumns(ctx, m.store.DB, entity.Table)
	if err != nil {
		return fmt.Errorf("get columns for %s: %w", entity.Table, err)
	}

	for _, f := range entity.Fields {
		if _, ok := existing[f.Name]; !ok {
			colType := m.store.Dialect.ColumnType(f.Type, f.Precision)
			notNull := ""
			if f.Required && !f.Nullable {
				notNull = " NOT NULL DEFAULT ''" // safe default for existing rows
			}
			sqlStr := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s%s", entity.Table, f.Name, colType, notNull)
			if _, err := m.store.DB.ExecContext(ctx, sqlStr); err != nil {
				return fmt.Errorf("add column %s.%s: %w", entity.Table, f.Name, err)
			}
		}
	}

	// Ensure deleted_at column for soft delete
	if entity.SoftDelete {
		if _, ok := existing["deleted_at"]; !ok {
			colType := m.store.Dialect.ColumnType("timestamp", 0)
			sqlStr := fmt.Sprintf("ALTER TABLE %s ADD COLUMN deleted_at %s", entity.Table, colType)
			if _, err := m.store.DB.ExecContext(ctx, sqlStr); err != nil {
				return fmt.Errorf("add deleted_at column to %s: %w", entity.Table, err)
			}
		}
	}

	// Create missing indexes
	if err := m.createIndexes(ctx, entity); err != nil {
		return fmt.Errorf("create indexes for %s: %w", entity.Table, err)
	}

	return nil
}

func (m *Migrator) buildColumnDef(entity *metadata.Entity, f *metadata.Field) string {
	col := f.Name + " " + m.store.Dialect.ColumnType(f.Type, f.Precision)

	if f.Name == entity.PrimaryKey.Field {
		col += " PRIMARY KEY"
		uuidDefault := m.store.Dialect.UUIDDefault()
		if entity.PrimaryKey.Generated && entity.PrimaryKey.Type == "uuid" && uuidDefault != "" {
			col += " " + uuidDefault
		}
	}

	if f.Required && !f.Nullable && f.Name != entity.PrimaryKey.Field {
		col += " NOT NULL"
	}

	if f.Default != nil && f.Name != entity.PrimaryKey.Field {
		switch v := f.Default.(type) {
		case string:
			col += fmt.Sprintf(" DEFAULT '%s'", v)
		case float64:
			col += fmt.Sprintf(" DEFAULT %v", v)
		case bool:
			if m.store.Dialect.Name() == "sqlite" {
				if v {
					col += " DEFAULT 1"
				} else {
					col += " DEFAULT 0"
				}
			} else {
				col += fmt.Sprintf(" DEFAULT %t", v)
			}
		default:
			col += fmt.Sprintf(" DEFAULT '%v'", v)
		}
	}

	return col
}

func (m *Migrator) createIndexes(ctx context.Context, entity *metadata.Entity) error {
	for _, f := range entity.Fields {
		if f.Unique {
			sqlStr := fmt.Sprintf("CREATE UNIQUE INDEX IF NOT EXISTS idx_%s_%s ON %s (%s)",
				entity.Table, f.Name, entity.Table, f.Name)
			if _, err := m.store.DB.ExecContext(ctx, sqlStr); err != nil {
				return fmt.Errorf("create unique index on %s.%s: %w", entity.Table, f.Name, err)
			}
		}
	}

	if entity.SoftDelete {
		sqlStr := m.store.Dialect.SoftDeleteIndexSQL(entity.Table)
		if _, err := m.store.DB.ExecContext(ctx, sqlStr); err != nil {
			return fmt.Errorf("create soft delete index on %s: %w", entity.Table, err)
		}
	}

	return nil
}

// GenerateUUID generates a new UUID string. Used when the database dialect
// does not support gen_random_uuid() (e.g., SQLite).
func GenerateUUID() string {
	return uuid.New().String()
}
