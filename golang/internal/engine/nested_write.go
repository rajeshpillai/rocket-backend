package engine

import (
	"context"
	"fmt"
	"regexp"

	"rocket-backend/internal/instrument"
	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

var uuidRE = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// WritePlan describes the full set of operations for a write request.
type WritePlan struct {
	IsCreate  bool
	Entity    *metadata.Entity
	Fields    map[string]any
	ID        any // nil for create, set for update
	ChildOps  []*RelationWrite
	User      *metadata.UserContext
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
	ctx, span := instrument.GetInstrumenter(ctx).StartSpan(ctx, "engine", "writer", "nested_write.execute")
	defer span.End()
	span.SetEntity(plan.Entity.Name, fmt.Sprintf("%v", plan.ID))

	tx, err := s.BeginTx(ctx)
	if err != nil {
		span.SetStatus("error")
		span.SetMetadata("error", err.Error())
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

	ruleErrs := EvaluateRules(ctx, reg, plan.Entity.Name, "before_write", plan.Fields, old, plan.IsCreate)
	if len(ruleErrs) > 0 {
		span.SetStatus("error")
		return nil, ValidationError(ruleErrs)
	}

	// Evaluate state machines (after rules, before SQL write)
	smErrs := EvaluateStateMachines(ctx, reg, plan.Entity.Name, plan.Fields, old, plan.IsCreate)
	if len(smErrs) > 0 {
		span.SetStatus("error")
		return nil, ValidationError(smErrs)
	}

	// Resolve file fields: UUID string → JSONB metadata object
	if err := resolveFileFields(ctx, tx, plan.Entity, plan.Fields); err != nil {
		span.SetStatus("error")
		span.SetMetadata("error", err.Error())
		return nil, fmt.Errorf("resolve file fields: %w", err)
	}

	var parentID any

	if plan.IsCreate {
		// INSERT parent
		sql, params := BuildInsertSQL(plan.Entity, plan.Fields)
		row, err := store.QueryRow(ctx, tx, sql, params...)
		if err != nil {
			span.SetStatus("error")
			span.SetMetadata("error", err.Error())
			return nil, fmt.Errorf("insert %s: %w", plan.Entity.Table, err)
		}
		parentID = row[plan.Entity.PrimaryKey.Field]
	} else {
		// UPDATE parent
		parentID = plan.ID
		sql, params := BuildUpdateSQL(plan.Entity, plan.ID, plan.Fields)
		if sql != "" {
			if _, err := store.Exec(ctx, tx, sql, params...); err != nil {
				span.SetStatus("error")
				span.SetMetadata("error", err.Error())
				return nil, fmt.Errorf("update %s: %w", plan.Entity.Table, err)
			}
		}
	}

	// Execute child writes
	for _, childOp := range plan.ChildOps {
		if err := ExecuteChildWrite(ctx, tx, reg, parentID, childOp); err != nil {
			span.SetStatus("error")
			span.SetMetadata("error", err.Error())
			return nil, fmt.Errorf("child write for %s: %w", childOp.Relation.Name, err)
		}
	}

	// Pre-commit: fire sync (before_write) webhooks
	action := "update"
	if plan.IsCreate {
		action = "create"
	}
	if err := FireSyncWebhooks(ctx, tx, reg, "before_write", plan.Entity.Name, action, plan.Fields, old, plan.User); err != nil {
		span.SetStatus("error")
		span.SetMetadata("error", err.Error())
		return nil, fmt.Errorf("sync webhook: %w", err)
	}

	// Commit
	if err := tx.Commit(ctx); err != nil {
		span.SetStatus("error")
		span.SetMetadata("error", err.Error())
		return nil, fmt.Errorf("commit: %w", err)
	}

	// Fetch the full record
	record, err := fetchRecord(ctx, s.Pool, plan.Entity, parentID)
	if err != nil {
		span.SetStatus("error")
		span.SetMetadata("error", err.Error())
		return nil, err
	}

	// Post-commit: trigger workflows for state transitions
	for _, sm := range reg.GetStateMachinesForEntity(plan.Entity.Name) {
		oldState := ""
		if v, ok := old[sm.Field]; ok && v != nil {
			oldState = fmt.Sprintf("%v", v)
		}
		newState := ""
		if v, ok := plan.Fields[sm.Field]; ok && v != nil {
			newState = fmt.Sprintf("%v", v)
		}
		if newState != "" && oldState != newState {
			TriggerWorkflows(ctx, s, reg, plan.Entity.Name, sm.Field, newState, record, parentID)
		}
	}

	// Post-commit: fire async (after_write) webhooks
	FireAsyncWebhooks(ctx, s, reg, "after_write", plan.Entity.Name, action, record, old, plan.User)

	span.SetStatus("ok")
	return record, nil
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

// resolveFileFields converts UUID strings in file-type fields to full JSONB metadata objects.
// If the value is already a map (full metadata), it passes through unchanged.
func resolveFileFields(ctx context.Context, q store.Querier, entity *metadata.Entity, fields map[string]any) error {
	for _, f := range entity.Fields {
		if f.Type != "file" {
			continue
		}
		val, ok := fields[f.Name]
		if !ok || val == nil {
			continue
		}
		// If already a map (full metadata object), pass through
		if _, isMap := val.(map[string]any); isMap {
			continue
		}
		// If it's a UUID string, resolve from _files
		strVal := fmt.Sprintf("%v", val)
		if !uuidRE.MatchString(strVal) {
			continue
		}

		row, err := store.QueryRow(ctx, q,
			"SELECT id, filename, size, mime_type FROM _files WHERE id = $1", strVal)
		if err != nil {
			return NewAppError("NOT_FOUND", 404, fmt.Sprintf("File %s not found", strVal))
		}

		fields[f.Name] = map[string]any{
			"id":        row["id"],
			"filename":  row["filename"],
			"size":      row["size"],
			"mime_type": row["mime_type"],
		}
	}
	return nil
}
