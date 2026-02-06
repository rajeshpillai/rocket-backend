package engine

import (
	"context"
	"fmt"
	"strings"

	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

// LoadIncludes fetches related data and attaches it to the parent rows.
func LoadIncludes(ctx context.Context, q store.Querier, reg *metadata.Registry, entity *metadata.Entity, rows []map[string]any, includes []string) error {
	if len(rows) == 0 || len(includes) == 0 {
		return nil
	}

	for _, incName := range includes {
		rel := reg.FindRelationForEntity(incName, entity.Name)
		if rel == nil {
			continue
		}

		if rel.Source == entity.Name {
			// Forward relation: load children by parent PK
			if err := loadForwardRelation(ctx, q, reg, entity, rel, rows, incName); err != nil {
				return err
			}
		} else if rel.Target == entity.Name {
			// Reverse relation: load parents by FK on current entity
			if err := loadReverseRelation(ctx, q, reg, entity, rel, rows, incName); err != nil {
				return err
			}
		}
	}

	return nil
}

// loadForwardRelation loads children for one_to_many, one_to_one, or many_to_many.
func loadForwardRelation(ctx context.Context, q store.Querier, reg *metadata.Registry, parentEntity *metadata.Entity, rel *metadata.Relation, rows []map[string]any, incName string) error {
	parentPKField := parentEntity.PrimaryKey.Field
	parentIDs := collectValues(rows, parentPKField)
	if len(parentIDs) == 0 {
		return nil
	}

	if rel.IsManyToMany() {
		return loadManyToMany(ctx, q, reg, rel, rows, parentPKField, parentIDs, incName)
	}

	targetEntity := reg.GetEntity(rel.Target)
	if targetEntity == nil {
		return fmt.Errorf("unknown target entity: %s", rel.Target)
	}

	// Query children
	columns := strings.Join(targetEntity.FieldNames(), ", ")
	sql := fmt.Sprintf("SELECT %s FROM %s WHERE %s = ANY($1)",
		columns, targetEntity.Table, rel.TargetKey)
	if targetEntity.SoftDelete {
		sql += " AND deleted_at IS NULL"
	}

	childRows, err := store.QueryRows(ctx, q, sql, parentIDs)
	if err != nil {
		return fmt.Errorf("load include %s: %w", incName, err)
	}

	// Group by FK
	grouped := make(map[string][]map[string]any)
	for _, child := range childRows {
		fk := fmt.Sprintf("%v", child[rel.TargetKey])
		grouped[fk] = append(grouped[fk], child)
	}

	// Attach to parent rows
	for _, row := range rows {
		pk := fmt.Sprintf("%v", row[parentPKField])
		if rel.IsOneToOne() {
			if children := grouped[pk]; len(children) > 0 {
				row[incName] = children[0]
			} else {
				row[incName] = nil
			}
		} else {
			row[incName] = grouped[pk]
		}
	}

	return nil
}

func loadManyToMany(ctx context.Context, q store.Querier, reg *metadata.Registry, rel *metadata.Relation, rows []map[string]any, parentPKField string, parentIDs []any, incName string) error {
	targetEntity := reg.GetEntity(rel.Target)
	if targetEntity == nil {
		return fmt.Errorf("unknown target entity: %s", rel.Target)
	}

	// Query join table
	joinSQL := fmt.Sprintf("SELECT %s, %s FROM %s WHERE %s = ANY($1)",
		rel.SourceJoinKey, rel.TargetJoinKey, rel.JoinTable, rel.SourceJoinKey)
	joinRows, err := store.QueryRows(ctx, q, joinSQL, parentIDs)
	if err != nil {
		return fmt.Errorf("load join table %s: %w", rel.JoinTable, err)
	}

	if len(joinRows) == 0 {
		for _, row := range rows {
			row[incName] = []map[string]any{}
		}
		return nil
	}

	// Collect target IDs
	targetIDs := make([]any, 0, len(joinRows))
	seen := make(map[string]bool)
	for _, jr := range joinRows {
		tid := fmt.Sprintf("%v", jr[rel.TargetJoinKey])
		if !seen[tid] {
			seen[tid] = true
			targetIDs = append(targetIDs, jr[rel.TargetJoinKey])
		}
	}

	// Query target records
	columns := strings.Join(targetEntity.FieldNames(), ", ")
	targetSQL := fmt.Sprintf("SELECT %s FROM %s WHERE %s = ANY($1)",
		columns, targetEntity.Table, targetEntity.PrimaryKey.Field)
	if targetEntity.SoftDelete {
		targetSQL += " AND deleted_at IS NULL"
	}
	targetRows, err := store.QueryRows(ctx, q, targetSQL, targetIDs)
	if err != nil {
		return fmt.Errorf("load targets for %s: %w", incName, err)
	}

	// Index targets by PK
	targetByPK := make(map[string]map[string]any, len(targetRows))
	for _, tr := range targetRows {
		pk := fmt.Sprintf("%v", tr[targetEntity.PrimaryKey.Field])
		targetByPK[pk] = tr
	}

	// Build source -> []target mapping from join rows
	sourceToTargets := make(map[string][]map[string]any)
	for _, jr := range joinRows {
		sid := fmt.Sprintf("%v", jr[rel.SourceJoinKey])
		tid := fmt.Sprintf("%v", jr[rel.TargetJoinKey])
		if target, ok := targetByPK[tid]; ok {
			sourceToTargets[sid] = append(sourceToTargets[sid], target)
		}
	}

	// Attach
	for _, row := range rows {
		pk := fmt.Sprintf("%v", row[parentPKField])
		if targets, ok := sourceToTargets[pk]; ok {
			row[incName] = targets
		} else {
			row[incName] = []map[string]any{}
		}
	}

	return nil
}

// loadReverseRelation loads parent records referenced by FK on the current entity.
func loadReverseRelation(ctx context.Context, q store.Querier, reg *metadata.Registry, entity *metadata.Entity, rel *metadata.Relation, rows []map[string]any, incName string) error {
	sourceEntity := reg.GetEntity(rel.Source)
	if sourceEntity == nil {
		return fmt.Errorf("unknown source entity: %s", rel.Source)
	}

	// Collect FK values from current rows
	fkValues := collectValues(rows, rel.TargetKey)
	if len(fkValues) == 0 {
		return nil
	}

	columns := strings.Join(sourceEntity.FieldNames(), ", ")
	sql := fmt.Sprintf("SELECT %s FROM %s WHERE %s = ANY($1)",
		columns, sourceEntity.Table, rel.SourceKey)
	if sourceEntity.SoftDelete {
		sql += " AND deleted_at IS NULL"
	}

	parentRows, err := store.QueryRows(ctx, q, sql, fkValues)
	if err != nil {
		return fmt.Errorf("load reverse include %s: %w", incName, err)
	}

	// Index by PK
	parentByPK := make(map[string]map[string]any, len(parentRows))
	for _, pr := range parentRows {
		pk := fmt.Sprintf("%v", pr[rel.SourceKey])
		parentByPK[pk] = pr
	}

	// Attach
	for _, row := range rows {
		fk := fmt.Sprintf("%v", row[rel.TargetKey])
		row[incName] = parentByPK[fk]
	}

	return nil
}

func collectValues(rows []map[string]any, field string) []any {
	seen := make(map[string]bool)
	var values []any
	for _, row := range rows {
		v := row[field]
		if v == nil {
			continue
		}
		s := fmt.Sprintf("%v", v)
		if !seen[s] {
			seen[s] = true
			values = append(values, v)
		}
	}
	return values
}
