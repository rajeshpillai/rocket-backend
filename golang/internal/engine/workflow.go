package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/expr-lang/expr"

	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

// TriggerWorkflows checks if any active workflows should be started based on
// a state transition. Called after a successful write commit.
func TriggerWorkflows(ctx context.Context, s *store.Store, reg *metadata.Registry,
	entity, field, toState string, record map[string]any, recordID any) {

	workflows := reg.GetWorkflowsForTrigger(entity, field, toState)
	if len(workflows) == 0 {
		return
	}

	for _, wf := range workflows {
		if err := createWorkflowInstance(ctx, s, reg, wf, record, recordID); err != nil {
			log.Printf("ERROR: failed to create workflow instance for %s: %v", wf.Name, err)
		}
	}
}

// createWorkflowInstance builds the initial context, inserts a workflow instance row,
// and starts executing steps.
func createWorkflowInstance(ctx context.Context, s *store.Store, reg *metadata.Registry,
	wf *metadata.Workflow, record map[string]any, recordID any) error {

	// Build context from workflow context mappings
	wfCtx := buildWorkflowContext(wf.Context, record, recordID)

	if len(wf.Steps) == 0 {
		return fmt.Errorf("workflow %s has no steps", wf.Name)
	}

	firstStepID := wf.Steps[0].ID

	// Marshal context and empty history
	ctxJSON, err := json.Marshal(wfCtx)
	if err != nil {
		return fmt.Errorf("marshal workflow context: %w", err)
	}
	historyJSON, _ := json.Marshal([]metadata.WorkflowHistoryEntry{})

	row, err := store.QueryRow(ctx, s.Pool,
		`INSERT INTO _workflow_instances (workflow_id, workflow_name, status, current_step, context, history)
		 VALUES ($1, $2, 'running', $3, $4, $5)
		 RETURNING id`,
		wf.ID, wf.Name, firstStepID, ctxJSON, historyJSON)
	if err != nil {
		return fmt.Errorf("insert workflow instance: %w", err)
	}

	instance := &metadata.WorkflowInstance{
		ID:           fmt.Sprintf("%v", row["id"]),
		WorkflowID:   wf.ID,
		WorkflowName: wf.Name,
		Status:       "running",
		CurrentStep:  firstStepID,
		Context:      wfCtx,
		History:      []metadata.WorkflowHistoryEntry{},
	}

	log.Printf("Created workflow instance %s for workflow %s", instance.ID, wf.Name)

	// Start advancing through steps
	return advanceWorkflow(ctx, s, reg, instance, wf)
}

// advanceWorkflow continues executing steps until the workflow pauses (approval) or ends.
func advanceWorkflow(ctx context.Context, s *store.Store, reg *metadata.Registry,
	instance *metadata.WorkflowInstance, wf *metadata.Workflow) error {

	for {
		if instance.Status != "running" {
			return nil
		}

		step := wf.FindStep(instance.CurrentStep)
		if step == nil {
			instance.Status = "failed"
			return persistInstance(ctx, s, instance)
		}

		paused, nextGoto, err := executeStep(ctx, s, reg, instance, wf, step)
		if err != nil {
			log.Printf("ERROR: workflow %s step %s failed: %v", wf.Name, step.ID, err)
			instance.Status = "failed"
			return persistInstance(ctx, s, instance)
		}

		if paused {
			return persistInstance(ctx, s, instance)
		}

		// Advance to next step
		if nextGoto == "" || nextGoto == "end" {
			instance.Status = "completed"
			instance.CurrentStep = ""
			return persistInstance(ctx, s, instance)
		}

		instance.CurrentStep = nextGoto
	}
}

// executeStep evaluates a single step. Returns (paused, nextGoto, error).
func executeStep(ctx context.Context, s *store.Store, reg *metadata.Registry,
	instance *metadata.WorkflowInstance, wf *metadata.Workflow, step *metadata.WorkflowStep) (bool, string, error) {

	switch step.Type {
	case "action":
		return executeActionStep(ctx, s, reg, instance, step)
	case "condition":
		return executeConditionStep(instance, step)
	case "approval":
		return executeApprovalStep(instance, step)
	default:
		return false, "", fmt.Errorf("unknown step type: %s", step.Type)
	}
}

func executeActionStep(ctx context.Context, s *store.Store, reg *metadata.Registry,
	instance *metadata.WorkflowInstance, step *metadata.WorkflowStep) (bool, string, error) {

	for _, action := range step.Actions {
		if err := executeWorkflowAction(ctx, s, reg, instance, &action); err != nil {
			return false, "", fmt.Errorf("action %s: %w", action.Type, err)
		}
	}

	// Record in history
	instance.History = append(instance.History, metadata.WorkflowHistoryEntry{
		Step:   step.ID,
		Status: "completed",
		At:     time.Now().UTC().Format(time.RFC3339),
	})

	next := ""
	if step.Then != nil {
		next = step.Then.Goto
	}
	return false, next, nil
}

func executeConditionStep(instance *metadata.WorkflowInstance, step *metadata.WorkflowStep) (bool, string, error) {
	if step.Expression == "" {
		return false, "", fmt.Errorf("condition step %s has no expression", step.ID)
	}

	env := map[string]any{
		"context": instance.Context,
	}

	compiled, err := expr.Compile(step.Expression, expr.AsBool())
	if err != nil {
		return false, "", fmt.Errorf("compile condition: %w", err)
	}

	result, err := expr.Run(compiled, env)
	if err != nil {
		return false, "", fmt.Errorf("evaluate condition: %w", err)
	}

	isTrue, ok := result.(bool)
	if !ok {
		return false, "", fmt.Errorf("condition did not return bool")
	}

	status := "on_false"
	next := ""
	if isTrue {
		status = "on_true"
		if step.OnTrue != nil {
			next = step.OnTrue.Goto
		}
	} else {
		if step.OnFalse != nil {
			next = step.OnFalse.Goto
		}
	}

	instance.History = append(instance.History, metadata.WorkflowHistoryEntry{
		Step:   step.ID,
		Status: status,
		At:     time.Now().UTC().Format(time.RFC3339),
	})

	return false, next, nil
}

func executeApprovalStep(instance *metadata.WorkflowInstance, step *metadata.WorkflowStep) (bool, string, error) {
	// Set deadline if timeout is specified
	if step.Timeout != "" {
		duration, err := time.ParseDuration(step.Timeout)
		if err == nil {
			deadline := time.Now().UTC().Add(duration).Format(time.RFC3339)
			instance.CurrentStepDeadline = &deadline
		}
	}

	// Approval step pauses the workflow
	return true, "", nil
}

// executeWorkflowAction executes a single workflow action.
func executeWorkflowAction(ctx context.Context, s *store.Store, reg *metadata.Registry,
	instance *metadata.WorkflowInstance, action *metadata.WorkflowAction) error {

	switch action.Type {
	case "set_field":
		return executeSetFieldAction(ctx, s, reg, instance, action)
	case "webhook":
		log.Printf("STUB: workflow webhook action %s %s (not yet implemented)", action.Method, action.URL)
		return nil
	case "create_record":
		log.Printf("STUB: workflow create_record action for entity %s (not yet implemented)", action.Entity)
		return nil
	case "send_event":
		log.Printf("STUB: workflow send_event action '%s' (not yet implemented)", action.Event)
		return nil
	default:
		log.Printf("WARN: unknown workflow action type: %s", action.Type)
		return nil
	}
}

// executeSetFieldAction performs a standalone UPDATE on the target entity/record.
func executeSetFieldAction(ctx context.Context, s *store.Store, reg *metadata.Registry,
	instance *metadata.WorkflowInstance, action *metadata.WorkflowAction) error {

	entityName := action.Entity
	if entityName == "" {
		return fmt.Errorf("set_field action missing entity")
	}

	entity := reg.GetEntity(entityName)
	if entity == nil {
		return fmt.Errorf("entity not found: %s", entityName)
	}

	// Resolve record_id from context path (wrap in envelope so "context.record_id" works)
	env := map[string]any{"context": instance.Context}
	recordID := resolveContextPath(env, action.RecordID)
	if recordID == nil {
		return fmt.Errorf("could not resolve record_id: %s", action.RecordID)
	}

	val := action.Value
	if s, ok := val.(string); ok && s == "now" {
		val = time.Now().UTC().Format(time.RFC3339)
	}

	sql := fmt.Sprintf("UPDATE %s SET %s = $1 WHERE %s = $2",
		entity.Table, action.Field, entity.PrimaryKey.Field)
	if _, err := store.Exec(ctx, s.Pool, sql, val, recordID); err != nil {
		return fmt.Errorf("set_field UPDATE: %w", err)
	}

	return nil
}

// ResolveWorkflowAction handles approve/reject on a paused workflow instance.
func ResolveWorkflowAction(ctx context.Context, s *store.Store, reg *metadata.Registry,
	instanceID string, action string, userID string) (*metadata.WorkflowInstance, error) {

	instance, err := loadWorkflowInstance(ctx, s, instanceID)
	if err != nil {
		return nil, err
	}

	if instance.Status != "running" {
		return nil, fmt.Errorf("workflow instance is not running (status: %s)", instance.Status)
	}

	// Load workflow definition
	wf := reg.GetWorkflow(instance.WorkflowName)
	if wf == nil {
		return nil, fmt.Errorf("workflow definition not found: %s", instance.WorkflowName)
	}

	step := wf.FindStep(instance.CurrentStep)
	if step == nil {
		return nil, fmt.Errorf("current step not found: %s", instance.CurrentStep)
	}
	if step.Type != "approval" {
		return nil, fmt.Errorf("current step is not an approval step")
	}

	// Record in history
	instance.History = append(instance.History, metadata.WorkflowHistoryEntry{
		Step:   step.ID,
		Status: action, // "approved" or "rejected"
		By:     userID,
		At:     time.Now().UTC().Format(time.RFC3339),
	})
	instance.CurrentStepDeadline = nil

	// Determine next step
	var nextGoto string
	switch action {
	case "approved":
		if step.OnApprove != nil {
			nextGoto = step.OnApprove.Goto
		}
	case "rejected":
		if step.OnReject != nil {
			nextGoto = step.OnReject.Goto
		}
	default:
		return nil, fmt.Errorf("invalid action: %s", action)
	}

	if nextGoto == "" || nextGoto == "end" {
		instance.Status = "completed"
		instance.CurrentStep = ""
		if err := persistInstance(ctx, s, instance); err != nil {
			return nil, err
		}
		return instance, nil
	}

	instance.CurrentStep = nextGoto
	if err := advanceWorkflow(ctx, s, reg, instance, wf); err != nil {
		return nil, err
	}

	// Reload instance after advancing (to get final state)
	return loadWorkflowInstance(ctx, s, instance.ID)
}

// buildWorkflowContext resolves context mappings from the trigger record.
func buildWorkflowContext(mappings map[string]string, record map[string]any, recordID any) map[string]any {
	ctx := make(map[string]any, len(mappings))
	for key, path := range mappings {
		ctx[key] = resolveContextPath(map[string]any{
			"trigger": map[string]any{
				"record_id": recordID,
				"record":    record,
			},
		}, path)
	}
	return ctx
}

// resolveContextPath resolves a dot-path like "trigger.record.amount" from a nested map.
func resolveContextPath(data map[string]any, path string) any {
	if path == "" {
		return nil
	}

	// If path is a direct context reference like "context.record_id"
	parts := strings.Split(path, ".")
	var current any = data

	for _, part := range parts {
		m, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = m[part]
	}

	return current
}

// persistInstance updates the workflow instance in the database.
func persistInstance(ctx context.Context, s *store.Store, instance *metadata.WorkflowInstance) error {
	ctxJSON, err := json.Marshal(instance.Context)
	if err != nil {
		return fmt.Errorf("marshal context: %w", err)
	}
	historyJSON, err := json.Marshal(instance.History)
	if err != nil {
		return fmt.Errorf("marshal history: %w", err)
	}

	_, err = store.Exec(ctx, s.Pool,
		`UPDATE _workflow_instances
		 SET status = $1, current_step = $2, current_step_deadline = $3, context = $4, history = $5, updated_at = NOW()
		 WHERE id = $6`,
		instance.Status, nilIfEmpty(instance.CurrentStep), instance.CurrentStepDeadline,
		ctxJSON, historyJSON, instance.ID)
	return err
}

// loadWorkflowInstance loads a single workflow instance by ID.
func loadWorkflowInstance(ctx context.Context, s *store.Store, id string) (*metadata.WorkflowInstance, error) {
	row, err := store.QueryRow(ctx, s.Pool,
		`SELECT id, workflow_id, workflow_name, status, current_step, current_step_deadline, context, history, created_at, updated_at
		 FROM _workflow_instances WHERE id = $1`, id)
	if err != nil {
		return nil, fmt.Errorf("workflow instance not found: %s", id)
	}

	return parseWorkflowInstanceRow(row)
}

// ListPendingInstances returns workflow instances that are running (awaiting approval).
func ListPendingInstances(ctx context.Context, s *store.Store) ([]*metadata.WorkflowInstance, error) {
	rows, err := store.QueryRows(ctx, s.Pool,
		`SELECT id, workflow_id, workflow_name, status, current_step, current_step_deadline, context, history, created_at, updated_at
		 FROM _workflow_instances WHERE status = 'running' AND current_step IS NOT NULL
		 ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}

	var instances []*metadata.WorkflowInstance
	for _, row := range rows {
		inst, err := parseWorkflowInstanceRow(row)
		if err != nil {
			log.Printf("WARN: skipping workflow instance: %v", err)
			continue
		}
		instances = append(instances, inst)
	}
	return instances, nil
}

func parseWorkflowInstanceRow(row map[string]any) (*metadata.WorkflowInstance, error) {
	instance := &metadata.WorkflowInstance{
		ID:           fmt.Sprintf("%v", row["id"]),
		WorkflowID:   fmt.Sprintf("%v", row["workflow_id"]),
		WorkflowName: fmt.Sprintf("%v", row["workflow_name"]),
		Status:       fmt.Sprintf("%v", row["status"]),
	}

	if cs, ok := row["current_step"]; ok && cs != nil {
		instance.CurrentStep = fmt.Sprintf("%v", cs)
	}
	if d, ok := row["current_step_deadline"]; ok && d != nil {
		s := fmt.Sprintf("%v", d)
		instance.CurrentStepDeadline = &s
	}
	if ca, ok := row["created_at"]; ok && ca != nil {
		instance.CreatedAt = fmt.Sprintf("%v", ca)
	}
	if ua, ok := row["updated_at"]; ok && ua != nil {
		instance.UpdatedAt = fmt.Sprintf("%v", ua)
	}

	// Parse context JSONB
	instance.Context = make(map[string]any)
	if ctxRaw, ok := row["context"]; ok && ctxRaw != nil {
		switch v := ctxRaw.(type) {
		case map[string]any:
			instance.Context = v
		case string:
			json.Unmarshal([]byte(v), &instance.Context)
		}
	}

	// Parse history JSONB
	instance.History = []metadata.WorkflowHistoryEntry{}
	if histRaw, ok := row["history"]; ok && histRaw != nil {
		switch v := histRaw.(type) {
		case []any:
			data, _ := json.Marshal(v)
			json.Unmarshal(data, &instance.History)
		case string:
			json.Unmarshal([]byte(v), &instance.History)
		}
	}

	return instance, nil
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
