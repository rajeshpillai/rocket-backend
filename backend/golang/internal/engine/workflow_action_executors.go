package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

// ActionExecutor handles execution of a single workflow action type.
type ActionExecutor interface {
	Execute(ctx context.Context, q store.Querier, reg *metadata.Registry, instance *metadata.WorkflowInstance, action *metadata.WorkflowAction) error
}

// SetFieldActionExecutor performs a field update on a target entity record.
type SetFieldActionExecutor struct{}

func (e *SetFieldActionExecutor) Execute(ctx context.Context, q store.Querier, reg *metadata.Registry,
	instance *metadata.WorkflowInstance, action *metadata.WorkflowAction) error {

	entityName := action.Entity
	if entityName == "" {
		return fmt.Errorf("set_field action missing entity")
	}

	entity := reg.GetEntity(entityName)
	if entity == nil {
		return fmt.Errorf("entity not found: %s", entityName)
	}

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
	if _, err := store.Exec(ctx, q, sql, val, recordID); err != nil {
		return fmt.Errorf("set_field UPDATE: %w", err)
	}

	return nil
}

// WebhookActionExecutor dispatches an HTTP request as a workflow action.
type WebhookActionExecutor struct{}

func (e *WebhookActionExecutor) Execute(ctx context.Context, _ store.Querier, _ *metadata.Registry,
	instance *metadata.WorkflowInstance, action *metadata.WorkflowAction) error {

	body, _ := json.Marshal(instance.Context)
	method := action.Method
	if method == "" {
		method = "POST"
	}

	result := DispatchWebhookDirect(ctx, action.URL, method, nil, body)
	if result.Error != "" {
		return fmt.Errorf("workflow webhook %s %s failed: %s", method, action.URL, result.Error)
	}
	if result.StatusCode < 200 || result.StatusCode >= 300 {
		return fmt.Errorf("workflow webhook %s %s returned HTTP %d", method, action.URL, result.StatusCode)
	}
	return nil
}

// CreateRecordActionExecutor creates a new record in a target entity (stub).
type CreateRecordActionExecutor struct{}

func (e *CreateRecordActionExecutor) Execute(_ context.Context, _ store.Querier, _ *metadata.Registry,
	_ *metadata.WorkflowInstance, action *metadata.WorkflowAction) error {
	log.Printf("STUB: workflow create_record action for entity %s (not yet implemented)", action.Entity)
	return nil
}

// SendEventActionExecutor emits a named event (stub).
type SendEventActionExecutor struct{}

func (e *SendEventActionExecutor) Execute(_ context.Context, _ store.Querier, _ *metadata.Registry,
	_ *metadata.WorkflowInstance, action *metadata.WorkflowAction) error {
	log.Printf("STUB: workflow send_event action '%s' (not yet implemented)", action.Event)
	return nil
}

// DefaultActionExecutors returns the built-in set of action executors.
func DefaultActionExecutors() map[string]ActionExecutor {
	return map[string]ActionExecutor{
		"set_field":     &SetFieldActionExecutor{},
		"webhook":       &WebhookActionExecutor{},
		"create_record": &CreateRecordActionExecutor{},
		"send_event":    &SendEventActionExecutor{},
	}
}
