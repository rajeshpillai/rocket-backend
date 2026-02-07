package engine

import (
	"context"
	"fmt"

	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

// WritePlan describes the full set of operations for a write request.
type WritePlan struct {
	IsCreate  bool
	Entity    *metadata.Entity
	Fields    map[string]any
	ID        any // nil for create, set for update
	ChildOps  []*RelationWrite
}

// PlanWrite builds a WritePlan from the request body without executing any SQL.
func PlanWrite(entity *metadata.Entity, reg *metadata.Registry, body map[string]any, existingID any) (*WritePlan, []ErrorDetail) {
	fields, relWrites, unknownKeys := SeparateFieldsAndRelations(entity, reg, body)

	// Reject unknown keys
	if len(unknownKeys) > 0 {
		var errs []ErrorDetail
		for _, key := range unknownKeys {
			errs = append(errs, ErrorDetail{
				Field:   key,
				Rule:    "unknown",
				Message: fmt.Sprintf("Unknown field or relation: %s", key),
			})
		}
		return nil, errs
	}

	isCreate := existingID == nil

	// Validate fields
	validationErrs := ValidateFields(entity, fields, isCreate)
	if len(validationErrs) > 0 {
		return nil, validationErrs
	}

	plan := &WritePlan{
		IsCreate: isCreate,
		Entity:   entity,
		Fields:   fields,
		ID:       existingID,
	}

	for _, rw := range relWrites {
		plan.ChildOps = append(plan.ChildOps, rw)
	}

	return plan, nil
}

// ExecuteWritePlan runs the planned operations inside a single transaction.
// Returns the created/updated record.
func ExecuteWritePlan(ctx context.Context, s *store.Store, reg *metadata.Registry, plan *WritePlan) (map[string]any, error) {
	tx, err := s.BeginTx(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Evaluate rules (field → expression → computed)
	var old map[string]any
	if !plan.IsCreate {
		old, _ = fetchRecord(ctx, tx, plan.Entity, plan.ID)
	}
	if old == nil {
		old = map[string]any{}
	}

	ruleErrs := EvaluateRules(reg, plan.Entity.Name, "before_write", plan.Fields, old, plan.IsCreate)
	if len(ruleErrs) > 0 {
		return nil, ValidationError(ruleErrs)
	}

	var parentID any

	if plan.IsCreate {
		// INSERT parent
		sql, params := BuildInsertSQL(plan.Entity, plan.Fields)
		row, err := store.QueryRow(ctx, tx, sql, params...)
		if err != nil {
			return nil, fmt.Errorf("insert %s: %w", plan.Entity.Table, err)
		}
		parentID = row[plan.Entity.PrimaryKey.Field]
	} else {
		// UPDATE parent
		parentID = plan.ID
		sql, params := BuildUpdateSQL(plan.Entity, plan.ID, plan.Fields)
		if sql != "" {
			if _, err := store.Exec(ctx, tx, sql, params...); err != nil {
				return nil, fmt.Errorf("update %s: %w", plan.Entity.Table, err)
			}
		}
	}

	// Execute child writes
	for _, childOp := range plan.ChildOps {
		if err := ExecuteChildWrite(ctx, tx, reg, parentID, childOp); err != nil {
			return nil, fmt.Errorf("child write for %s: %w", childOp.Relation.Name, err)
		}
	}

	// Commit
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	// Fetch and return the full record
	return fetchRecord(ctx, s.Pool, plan.Entity, parentID)
}

func fetchRecord(ctx context.Context, q store.Querier, entity *metadata.Entity, id any) (map[string]any, error) {
	columns := entity.FieldNames()
	if entity.SoftDelete && entity.GetField("deleted_at") == nil {
		columns = append(columns, "deleted_at")
	}

	sql := fmt.Sprintf("SELECT %s FROM %s WHERE %s = $1",
		joinColumns(columns), entity.Table, entity.PrimaryKey.Field)
	if entity.SoftDelete {
		sql += " AND deleted_at IS NULL"
	}

	return store.QueryRow(ctx, q, sql, id)
}

func joinColumns(cols []string) string {
	result := ""
	for i, c := range cols {
		if i > 0 {
			result += ", "
		}
		result += c
	}
	return result
}
