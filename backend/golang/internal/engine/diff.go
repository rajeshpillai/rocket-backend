package engine

import (
	"context"
	"fmt"
	"strings"

	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

// ExecuteChildWrite dispatches to the appropriate write mode handler.
func ExecuteChildWrite(ctx context.Context, q store.Querier, dialect store.Dialect, reg *metadata.Registry, parentID any, rw *RelationWrite) error {
	if rw.Relation.IsManyToMany() {
		return executeManyToManyWrite(ctx, q, dialect, reg, parentID, rw)
	}
	return executeOneToManyWrite(ctx, q, dialect, reg, parentID, rw)
}

func executeOneToManyWrite(ctx context.Context, q store.Querier, dialect store.Dialect, reg *metadata.Registry, parentID any, rw *RelationWrite) error {
	rel := rw.Relation
	targetEntity := reg.GetEntity(rel.Target)
	if targetEntity == nil {
		return fmt.Errorf("unknown target entity: %s", rel.Target)
	}

	switch rw.WriteMode {
	case "diff":
		return executeDiffWrite(ctx, q, dialect, targetEntity, rel, parentID, rw.Data)
	case "replace":
		return executeReplaceWrite(ctx, q, dialect, targetEntity, rel, parentID, rw.Data)
	case "append":
		return executeAppendWrite(ctx, q, dialect, targetEntity, rel, parentID, rw.Data)
	default:
		return executeDiffWrite(ctx, q, dialect, targetEntity, rel, parentID, rw.Data)
	}
}

func executeDiffWrite(ctx context.Context, q store.Querier, dialect store.Dialect, targetEntity *metadata.Entity, rel *metadata.Relation, parentID any, data []map[string]any) error {
	pkField := targetEntity.PrimaryKey.Field

	// Fetch current children
	existing, err := fetchCurrentChildren(ctx, q, dialect, targetEntity, rel, parentID)
	if err != nil {
		return err
	}
	existingByPK := indexByPK(existing, pkField)

	for _, row := range data {
		// Check for _delete flag
		if del, ok := row["_delete"]; ok && del == true {
			pk := row[pkField]
			if pk != nil {
				if err := softDeleteChild(ctx, q, dialect, targetEntity, pk); err != nil {
					return err
				}
			}
			continue
		}

		pk := row[pkField]
		if pk != nil {
			// Has PK — check if exists
			if _, exists := existingByPK[fmt.Sprintf("%v", pk)]; exists {
				// UPDATE
				if err := updateChild(ctx, q, dialect, targetEntity, pk, row); err != nil {
					return err
				}
			}
			// If PK provided but doesn't exist in current children, skip in diff mode
		} else {
			// No PK — INSERT
			row[rel.TargetKey] = parentID
			if err := insertChild(ctx, q, dialect, targetEntity, row); err != nil {
				return err
			}
		}
	}

	return nil
}

func executeReplaceWrite(ctx context.Context, q store.Querier, dialect store.Dialect, targetEntity *metadata.Entity, rel *metadata.Relation, parentID any, data []map[string]any) error {
	pkField := targetEntity.PrimaryKey.Field

	existing, err := fetchCurrentChildren(ctx, q, dialect, targetEntity, rel, parentID)
	if err != nil {
		return err
	}
	existingByPK := indexByPK(existing, pkField)
	seen := make(map[string]bool)

	for _, row := range data {
		pk := row[pkField]
		if pk != nil {
			pkStr := fmt.Sprintf("%v", pk)
			if _, exists := existingByPK[pkStr]; exists {
				seen[pkStr] = true
				if err := updateChild(ctx, q, dialect, targetEntity, pk, row); err != nil {
					return err
				}
			}
		} else {
			row[rel.TargetKey] = parentID
			if err := insertChild(ctx, q, dialect, targetEntity, row); err != nil {
				return err
			}
		}
	}

	// Soft-delete existing rows not in incoming
	for pkStr := range existingByPK {
		if !seen[pkStr] {
			pk := existingByPK[pkStr][pkField]
			if err := softDeleteChild(ctx, q, dialect, targetEntity, pk); err != nil {
				return err
			}
		}
	}

	return nil
}

func executeAppendWrite(ctx context.Context, q store.Querier, dialect store.Dialect, targetEntity *metadata.Entity, rel *metadata.Relation, parentID any, data []map[string]any) error {
	pkField := targetEntity.PrimaryKey.Field

	for _, row := range data {
		if row[pkField] != nil {
			continue // Skip rows with PK in append mode
		}
		row[rel.TargetKey] = parentID
		if err := insertChild(ctx, q, dialect, targetEntity, row); err != nil {
			return err
		}
	}
	return nil
}

// Many-to-many writes operate on the join table.
func executeManyToManyWrite(ctx context.Context, q store.Querier, dialect store.Dialect, reg *metadata.Registry, parentID any, rw *RelationWrite) error {
	rel := rw.Relation
	targetEntity := reg.GetEntity(rel.Target)
	if targetEntity == nil {
		return fmt.Errorf("unknown target entity: %s", rel.Target)
	}
	targetPKField := targetEntity.PrimaryKey.Field

	switch rw.WriteMode {
	case "replace":
		// Delete all current join rows, insert all incoming
		pb := dialect.NewParamBuilder()
		delSQL := fmt.Sprintf("DELETE FROM %s WHERE %s = %s", rel.JoinTable, rel.SourceJoinKey, pb.Add(parentID))
		if _, err := store.Exec(ctx, q, delSQL, pb.Params()...); err != nil {
			return fmt.Errorf("delete join rows: %w", err)
		}
		for _, row := range rw.Data {
			targetID := row[targetPKField]
			if targetID == nil {
				targetID = row["id"]
			}
			if targetID == nil {
				continue
			}
			if err := insertJoinRow(ctx, q, dialect, rel, parentID, targetID); err != nil {
				return err
			}
		}

	case "append":
		for _, row := range rw.Data {
			targetID := row[targetPKField]
			if targetID == nil {
				targetID = row["id"]
			}
			if targetID == nil {
				continue
			}
			// Insert only if not exists
			pb := dialect.NewParamBuilder()
			sql := fmt.Sprintf(
				"INSERT INTO %s (%s, %s) VALUES (%s, %s) ON CONFLICT DO NOTHING",
				rel.JoinTable, rel.SourceJoinKey, rel.TargetJoinKey, pb.Add(parentID), pb.Add(targetID))
			if _, err := store.Exec(ctx, q, sql, pb.Params()...); err != nil {
				return fmt.Errorf("insert join row: %w", err)
			}
		}

	default: // diff
		// Fetch current join rows
		pb := dialect.NewParamBuilder()
		currentSQL := fmt.Sprintf("SELECT %s FROM %s WHERE %s = %s",
			rel.TargetJoinKey, rel.JoinTable, rel.SourceJoinKey, pb.Add(parentID))
		currentRows, err := store.QueryRows(ctx, q, currentSQL, pb.Params()...)
		if err != nil {
			return fmt.Errorf("fetch current join rows: %w", err)
		}
		currentTargets := make(map[string]bool)
		for _, r := range currentRows {
			if v := r[rel.TargetJoinKey]; v != nil {
				currentTargets[fmt.Sprintf("%v", v)] = true
			}
		}

		for _, row := range rw.Data {
			targetID := row[targetPKField]
			if targetID == nil {
				targetID = row["id"]
			}
			if targetID == nil {
				continue
			}

			if del, ok := row["_delete"]; ok && del == true {
				dpb := dialect.NewParamBuilder()
				delSQL := fmt.Sprintf("DELETE FROM %s WHERE %s = %s AND %s = %s",
					rel.JoinTable, rel.SourceJoinKey, dpb.Add(parentID), rel.TargetJoinKey, dpb.Add(targetID))
				if _, err := store.Exec(ctx, q, delSQL, dpb.Params()...); err != nil {
					return fmt.Errorf("delete join row: %w", err)
				}
				continue
			}

			targetStr := fmt.Sprintf("%v", targetID)
			if !currentTargets[targetStr] {
				if err := insertJoinRow(ctx, q, dialect, rel, parentID, targetID); err != nil {
					return err
				}
			}
		}
	}

	return nil
}

// Helper functions

func fetchCurrentChildren(ctx context.Context, q store.Querier, dialect store.Dialect, entity *metadata.Entity, rel *metadata.Relation, parentID any) ([]map[string]any, error) {
	columns := strings.Join(entity.FieldNames(), ", ")
	sql := fmt.Sprintf("SELECT %s FROM %s WHERE %s = %s", columns, entity.Table, rel.TargetKey, dialect.Placeholder(1))
	if entity.SoftDelete {
		sql += " AND deleted_at IS NULL"
	}
	return store.QueryRows(ctx, q, sql, parentID)
}

func indexByPK(rows []map[string]any, pkField string) map[string]map[string]any {
	m := make(map[string]map[string]any, len(rows))
	for _, row := range rows {
		if pk := row[pkField]; pk != nil {
			m[fmt.Sprintf("%v", pk)] = row
		}
	}
	return m
}

func insertChild(ctx context.Context, q store.Querier, dialect store.Dialect, entity *metadata.Entity, fields map[string]any) error {
	sql, params := BuildInsertSQL(entity, fields, dialect)
	_, err := store.QueryRows(ctx, q, sql, params...)
	if err != nil {
		return fmt.Errorf("insert %s: %w", entity.Table, err)
	}
	return nil
}

func updateChild(ctx context.Context, q store.Querier, dialect store.Dialect, entity *metadata.Entity, id any, fields map[string]any) error {
	sql, params := BuildUpdateSQL(entity, id, fields, dialect)
	if sql == "" {
		return nil // nothing to update
	}
	if _, err := store.Exec(ctx, q, sql, params...); err != nil {
		return fmt.Errorf("update %s: %w", entity.Table, err)
	}
	return nil
}

func softDeleteChild(ctx context.Context, q store.Querier, dialect store.Dialect, entity *metadata.Entity, id any) error {
	if entity.SoftDelete {
		sql, params := BuildSoftDeleteSQL(entity, id, dialect)
		if _, err := store.Exec(ctx, q, sql, params...); err != nil {
			return fmt.Errorf("soft delete %s: %w", entity.Table, err)
		}
	} else {
		sql, params := BuildHardDeleteSQL(entity, id, dialect)
		if _, err := store.Exec(ctx, q, sql, params...); err != nil {
			return fmt.Errorf("hard delete %s: %w", entity.Table, err)
		}
	}
	return nil
}

func insertJoinRow(ctx context.Context, q store.Querier, dialect store.Dialect, rel *metadata.Relation, sourceID, targetID any) error {
	pb := dialect.NewParamBuilder()
	sql := fmt.Sprintf("INSERT INTO %s (%s, %s) VALUES (%s, %s)",
		rel.JoinTable, rel.SourceJoinKey, rel.TargetJoinKey, pb.Add(sourceID), pb.Add(targetID))
	if _, err := store.Exec(ctx, q, sql, pb.Params()...); err != nil {
		return fmt.Errorf("insert join row in %s: %w", rel.JoinTable, err)
	}
	return nil
}
