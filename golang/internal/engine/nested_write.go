package engine

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"unicode"

	"rocket-backend/internal/instrument"
	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"

	"golang.org/x/text/unicode/norm"
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
	defer tx.Rollback() //nolint:errcheck

	// Evaluate rules (field -> expression -> computed)
	var old map[string]any
	if !plan.IsCreate {
		old, _ = fetchRecord(ctx, tx, plan.Entity, plan.ID, s.Dialect)
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

	// Auto-generate slug if configured
	if err := autoGenerateSlug(ctx, tx, plan.Entity, s.Dialect, plan.Fields, plan.IsCreate, old, plan.ID); err != nil {
		span.SetStatus("error")
		span.SetMetadata("error", err.Error())
		return nil, err
	}

	// Resolve file fields: UUID string -> JSONB metadata object
	if err := resolveFileFields(ctx, tx, plan.Entity, plan.Fields, s.Dialect); err != nil {
		span.SetStatus("error")
		span.SetMetadata("error", err.Error())
		return nil, fmt.Errorf("resolve file fields: %w", err)
	}

	var parentID any

	if plan.IsCreate {
		// INSERT parent
		sql, params := BuildInsertSQL(plan.Entity, plan.Fields, s.Dialect)
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
		sql, params := BuildUpdateSQL(plan.Entity, plan.ID, plan.Fields, s.Dialect)
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
		if err := ExecuteChildWrite(ctx, tx, s.Dialect, reg, parentID, childOp); err != nil {
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
	if err := FireSyncWebhooks(ctx, tx, s.Dialect, reg, "before_write", plan.Entity.Name, action, plan.Fields, old, plan.User); err != nil {
		span.SetStatus("error")
		span.SetMetadata("error", err.Error())
		return nil, fmt.Errorf("sync webhook: %w", err)
	}

	// Commit
	if err := tx.Commit(); err != nil {
		span.SetStatus("error")
		span.SetMetadata("error", err.Error())
		return nil, fmt.Errorf("commit: %w", err)
	}

	// Fetch the full record
	record, err := fetchRecord(ctx, s.DB, plan.Entity, parentID, s.Dialect)
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

func fetchRecord(ctx context.Context, q store.Querier, entity *metadata.Entity, id any, dialect store.Dialect) (map[string]any, error) {
	columns := entity.FieldNames()
	if entity.SoftDelete && entity.GetField("deleted_at") == nil {
		columns = append(columns, "deleted_at")
	}

	softDeleteClause := ""
	if entity.SoftDelete {
		softDeleteClause = " AND deleted_at IS NULL"
	}

	// If entity has a slug config and the param doesn't look like the PK type, try slug first
	idStr := fmt.Sprintf("%v", id)
	if entity.Slug != nil && !looksLikePK(entity, idStr) {
		slugSQL := fmt.Sprintf("SELECT %s FROM %s WHERE %s = %s%s",
			joinColumns(columns), entity.Table, entity.Slug.Field, dialect.Placeholder(1), softDeleteClause)
		row, err := store.QueryRow(ctx, q, slugSQL, idStr)
		if err == nil {
			return row, nil
		}
		// slug lookup failed, fall through to PK lookup
	}

	sql := fmt.Sprintf("SELECT %s FROM %s WHERE %s = %s%s",
		joinColumns(columns), entity.Table, entity.PrimaryKey.Field, dialect.Placeholder(1), softDeleteClause)

	return store.QueryRow(ctx, q, sql, id)
}

var intRE = regexp.MustCompile(`^\d+$`)

func looksLikePK(entity *metadata.Entity, value string) bool {
	switch entity.PrimaryKey.Type {
	case "uuid":
		return uuidRE.MatchString(value)
	case "int", "integer", "bigint":
		return intRE.MatchString(value)
	default:
		return false // string PKs — can't distinguish, always try slug first
	}
}

// Slugify converts a string into a URL-friendly slug.
func Slugify(text string) string {
	// Normalize unicode and strip accents
	result := norm.NFD.String(text)
	var b strings.Builder
	for _, r := range result {
		if unicode.Is(unicode.Mn, r) {
			continue // skip combining marks (accents)
		}
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else if r >= 'A' && r <= 'Z' {
			b.WriteRune(r + 32) // lowercase
		} else {
			b.WriteByte('-')
		}
	}
	// Collapse multiple hyphens and trim
	s := b.String()
	for strings.Contains(s, "--") {
		s = strings.ReplaceAll(s, "--", "-")
	}
	s = strings.Trim(s, "-")
	return s
}

func generateUniqueSlug(ctx context.Context, q store.Querier, entity *metadata.Entity, dialect store.Dialect, baseSlug string, excludeID any) (string, error) {
	slugField := entity.Slug.Field
	softDeleteClause := ""
	if entity.SoftDelete {
		softDeleteClause = " AND deleted_at IS NULL"
	}

	checkSQL := fmt.Sprintf("SELECT 1 FROM %s WHERE %s = %s%s", entity.Table, slugField, dialect.Placeholder(1), softDeleteClause)
	excludeClause := ""
	if excludeID != nil {
		excludeClause = fmt.Sprintf(" AND %s != %s", entity.PrimaryKey.Field, dialect.Placeholder(2))
		checkSQL = fmt.Sprintf("SELECT 1 FROM %s WHERE %s = %s%s%s", entity.Table, slugField, dialect.Placeholder(1), softDeleteClause, excludeClause)
	}

	// Try base slug
	var params []any
	if excludeID != nil {
		params = []any{baseSlug, excludeID}
	} else {
		params = []any{baseSlug}
	}
	rows, err := store.QueryRows(ctx, q, checkSQL+" LIMIT 1", params...)
	if err != nil {
		return "", err
	}
	if len(rows) == 0 {
		return baseSlug, nil
	}

	// Append incrementing suffix
	for i := 2; i <= 100; i++ {
		candidate := fmt.Sprintf("%s-%d", baseSlug, i)
		params[0] = candidate
		rows, err = store.QueryRows(ctx, q, checkSQL+" LIMIT 1", params...)
		if err != nil {
			return "", err
		}
		if len(rows) == 0 {
			return candidate, nil
		}
	}

	// Fallback: should not normally reach here
	return fmt.Sprintf("%s-%d", baseSlug, 101), nil
}

func autoGenerateSlug(ctx context.Context, q store.Querier, entity *metadata.Entity, dialect store.Dialect, fields map[string]any, isCreate bool, old map[string]any, existingID any) error {
	slugCfg := entity.Slug
	if slugCfg == nil || slugCfg.Source == "" {
		return nil
	}

	// If slug is explicitly provided, skip auto-generation
	if val, ok := fields[slugCfg.Field]; ok && val != nil && fmt.Sprintf("%v", val) != "" {
		return nil
	}

	sourceVal, hasSource := fields[slugCfg.Source]
	if !hasSource || sourceVal == nil || fmt.Sprintf("%v", sourceVal) == "" {
		return nil
	}

	if isCreate {
		slug, err := generateUniqueSlug(ctx, q, entity, dialect, Slugify(fmt.Sprintf("%v", sourceVal)), nil)
		if err != nil {
			return fmt.Errorf("generate slug: %w", err)
		}
		fields[slugCfg.Field] = slug
	} else if slugCfg.RegenerateOnUpdate {
		// Only regenerate if source field changed
		oldSourceVal := fmt.Sprintf("%v", old[slugCfg.Source])
		newSourceVal := fmt.Sprintf("%v", sourceVal)
		if oldSourceVal == newSourceVal {
			return nil
		}
		slug, err := generateUniqueSlug(ctx, q, entity, dialect, Slugify(newSourceVal), existingID)
		if err != nil {
			return fmt.Errorf("generate slug: %w", err)
		}
		fields[slugCfg.Field] = slug
	}

	return nil
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
func resolveFileFields(ctx context.Context, q store.Querier, entity *metadata.Entity, fields map[string]any, dialect store.Dialect) error {
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
			fmt.Sprintf("SELECT id, filename, size, mime_type FROM _files WHERE id = %s", dialect.Placeholder(1)), strVal)
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
