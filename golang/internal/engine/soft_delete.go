package engine

import (
	"context"
	"fmt"

	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

// HandleCascadeDelete processes on_delete policies for all relations
// where the deleted entity is the source.
func HandleCascadeDelete(ctx context.Context, q store.Querier, dialect store.Dialect, reg *metadata.Registry, entity *metadata.Entity, recordID any) error {
	relations := reg.GetRelationsForSource(entity.Name)
	for _, rel := range relations {
		if err := executeCascade(ctx, q, dialect, reg, rel, recordID); err != nil {
			return fmt.Errorf("cascade delete for relation %s: %w", rel.Name, err)
		}
	}
	return nil
}

func executeCascade(ctx context.Context, q store.Querier, dialect store.Dialect, reg *metadata.Registry, rel *metadata.Relation, parentID any) error {
	switch rel.OnDelete {
	case "cascade":
		if rel.IsManyToMany() {
			// Hard-delete join table rows
			sql := fmt.Sprintf("DELETE FROM %s WHERE %s = %s", rel.JoinTable, rel.SourceJoinKey, dialect.Placeholder(1))
			if _, err := store.Exec(ctx, q, sql, parentID); err != nil {
				return err
			}
		} else {
			targetEntity := reg.GetEntity(rel.Target)
			if targetEntity != nil && targetEntity.SoftDelete {
				sql := fmt.Sprintf("UPDATE %s SET deleted_at = %s WHERE %s = %s AND deleted_at IS NULL",
					targetEntity.Table, dialect.NowExpr(), rel.TargetKey, dialect.Placeholder(1))
				if _, err := store.Exec(ctx, q, sql, parentID); err != nil {
					return err
				}
			} else if targetEntity != nil {
				sql := fmt.Sprintf("DELETE FROM %s WHERE %s = %s", targetEntity.Table, rel.TargetKey, dialect.Placeholder(1))
				if _, err := store.Exec(ctx, q, sql, parentID); err != nil {
					return err
				}
			}
		}

	case "set_null":
		targetEntity := reg.GetEntity(rel.Target)
		if targetEntity != nil {
			sql := fmt.Sprintf("UPDATE %s SET %s = NULL WHERE %s = %s",
				targetEntity.Table, rel.TargetKey, rel.TargetKey, dialect.Placeholder(1))
			if _, err := store.Exec(ctx, q, sql, parentID); err != nil {
				return err
			}
		}

	case "restrict":
		targetEntity := reg.GetEntity(rel.Target)
		if targetEntity != nil {
			countSQL := fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE %s = %s", targetEntity.Table, rel.TargetKey, dialect.Placeholder(1))
			if targetEntity.SoftDelete {
				countSQL += " AND deleted_at IS NULL"
			}
			rows, err := store.QueryRows(ctx, q, countSQL, parentID)
			if err != nil {
				return err
			}
			if len(rows) > 0 {
				if count, ok := rows[0]["count"].(int64); ok && count > 0 {
					return &AppError{
						Code:    "CONFLICT",
						Status:  409,
						Message: fmt.Sprintf("Cannot delete: %d related %s records exist", count, rel.Target),
					}
				}
			}
		}

	case "detach":
		if rel.IsManyToMany() {
			sql := fmt.Sprintf("DELETE FROM %s WHERE %s = %s", rel.JoinTable, rel.SourceJoinKey, dialect.Placeholder(1))
			if _, err := store.Exec(ctx, q, sql, parentID); err != nil {
				return err
			}
		}
	}

	return nil
}
