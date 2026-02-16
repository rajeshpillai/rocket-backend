package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

// WorkflowStore abstracts all persistence operations for workflow instances.
type WorkflowStore interface {
	CreateInstance(ctx context.Context, q store.Querier, dialect store.Dialect, data WorkflowInstanceData) (string, error)
	LoadInstance(ctx context.Context, q store.Querier, dialect store.Dialect, id string) (*metadata.WorkflowInstance, error)
	PersistInstance(ctx context.Context, q store.Querier, dialect store.Dialect, instance *metadata.WorkflowInstance) error
	ListPending(ctx context.Context, q store.Querier, dialect store.Dialect) ([]*metadata.WorkflowInstance, error)
	FindTimedOut(ctx context.Context, q store.Querier, dialect store.Dialect) ([]*metadata.WorkflowInstance, error)
	DeleteInstance(ctx context.Context, q store.Querier, dialect store.Dialect, id string) error
}

// WorkflowInstanceData is the data needed to create a new workflow instance.
type WorkflowInstanceData struct {
	WorkflowID   string
	WorkflowName string
	CurrentStep  string
	Context      map[string]any
}

// PgWorkflowStore implements WorkflowStore against Postgres _workflow_instances.
type PgWorkflowStore struct{}

func (s *PgWorkflowStore) CreateInstance(ctx context.Context, q store.Querier, dialect store.Dialect, data WorkflowInstanceData) (string, error) {
	ctxJSON, err := json.Marshal(data.Context)
	if err != nil {
		return "", fmt.Errorf("marshal workflow context: %w", err)
	}
	historyJSON, _ := json.Marshal([]metadata.WorkflowHistoryEntry{})

	pb := dialect.NewParamBuilder()
	if dialect.UUIDDefault() == "" {
		// SQLite: generate UUID in application code
		id := store.GenerateUUID()
		_, err = store.Exec(ctx, q,
			fmt.Sprintf(`INSERT INTO _workflow_instances (id, workflow_id, workflow_name, status, current_step, context, history)
			 VALUES (%s, %s, %s, 'running', %s, %s, %s)`,
				pb.Add(id), pb.Add(data.WorkflowID), pb.Add(data.WorkflowName),
				pb.Add(data.CurrentStep), pb.Add(string(ctxJSON)), pb.Add(string(historyJSON))),
			pb.Params()...)
		if err != nil {
			return "", fmt.Errorf("insert workflow instance: %w", err)
		}
		return id, nil
	}

	// PostgreSQL: use RETURNING id with gen_random_uuid() default
	row, err := store.QueryRow(ctx, q,
		fmt.Sprintf(`INSERT INTO _workflow_instances (workflow_id, workflow_name, status, current_step, context, history)
		 VALUES (%s, %s, 'running', %s, %s, %s)
		 RETURNING id`,
			pb.Add(data.WorkflowID), pb.Add(data.WorkflowName),
			pb.Add(data.CurrentStep), pb.Add(ctxJSON), pb.Add(historyJSON)),
		pb.Params()...)
	if err != nil {
		return "", fmt.Errorf("insert workflow instance: %w", err)
	}

	return fmt.Sprintf("%v", row["id"]), nil
}

func (s *PgWorkflowStore) LoadInstance(ctx context.Context, q store.Querier, dialect store.Dialect, id string) (*metadata.WorkflowInstance, error) {
	row, err := store.QueryRow(ctx, q,
		fmt.Sprintf(`SELECT id, workflow_id, workflow_name, status, current_step, current_step_deadline, context, history, created_at, updated_at
		 FROM _workflow_instances WHERE id = %s`, dialect.Placeholder(1)), id)
	if err != nil {
		return nil, fmt.Errorf("workflow instance not found: %s", id)
	}

	return ParseWorkflowInstanceRow(row)
}

func (s *PgWorkflowStore) PersistInstance(ctx context.Context, q store.Querier, dialect store.Dialect, instance *metadata.WorkflowInstance) error {
	ctxJSON, err := json.Marshal(instance.Context)
	if err != nil {
		return fmt.Errorf("marshal context: %w", err)
	}
	historyJSON, err := json.Marshal(instance.History)
	if err != nil {
		return fmt.Errorf("marshal history: %w", err)
	}

	pb := dialect.NewParamBuilder()
	_, err = store.Exec(ctx, q,
		fmt.Sprintf(`UPDATE _workflow_instances
		 SET status = %s, current_step = %s, current_step_deadline = %s, context = %s, history = %s, updated_at = %s
		 WHERE id = %s`,
			pb.Add(instance.Status), pb.Add(nilIfEmpty(instance.CurrentStep)), pb.Add(instance.CurrentStepDeadline),
			pb.Add(ctxJSON), pb.Add(historyJSON), dialect.NowExpr(), pb.Add(instance.ID)),
		pb.Params()...)
	return err
}

func (s *PgWorkflowStore) ListPending(ctx context.Context, q store.Querier, dialect store.Dialect) ([]*metadata.WorkflowInstance, error) {
	rows, err := store.QueryRows(ctx, q,
		`SELECT id, workflow_id, workflow_name, status, current_step, current_step_deadline, context, history, created_at, updated_at
		 FROM _workflow_instances WHERE status = 'running' AND current_step IS NOT NULL
		 ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}

	var instances []*metadata.WorkflowInstance
	for _, row := range rows {
		inst, err := ParseWorkflowInstanceRow(row)
		if err != nil {
			log.Printf("WARN: skipping workflow instance: %v", err)
			continue
		}
		instances = append(instances, inst)
	}
	return instances, nil
}

func (s *PgWorkflowStore) FindTimedOut(ctx context.Context, q store.Querier, dialect store.Dialect) ([]*metadata.WorkflowInstance, error) {
	rows, err := store.QueryRows(ctx, q,
		fmt.Sprintf(`SELECT id, workflow_id, workflow_name, status, current_step, current_step_deadline, context, history, created_at, updated_at
		 FROM _workflow_instances
		 WHERE status = 'running'
		   AND current_step_deadline IS NOT NULL
		   AND current_step_deadline < %s`, dialect.NowExpr()))
	if err != nil {
		return nil, err
	}

	var instances []*metadata.WorkflowInstance
	for _, row := range rows {
		inst, err := ParseWorkflowInstanceRow(row)
		if err != nil {
			log.Printf("WARN: skipping timed-out instance: %v", err)
			continue
		}
		instances = append(instances, inst)
	}
	return instances, nil
}

func (s *PgWorkflowStore) DeleteInstance(ctx context.Context, q store.Querier, dialect store.Dialect, id string) error {
	pb := dialect.NewParamBuilder()
	_, err := store.Exec(ctx, q,
		fmt.Sprintf(`DELETE FROM _workflow_instances WHERE id = %s`, pb.Add(id)), pb.Params()...)
	if err != nil {
		return fmt.Errorf("delete workflow instance: %w", err)
	}
	return nil
}

// ParseWorkflowInstanceRow parses a database row into a WorkflowInstance.
func ParseWorkflowInstanceRow(row map[string]any) (*metadata.WorkflowInstance, error) {
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

	instance.Context = make(map[string]any)
	if ctxRaw, ok := row["context"]; ok && ctxRaw != nil {
		switch v := ctxRaw.(type) {
		case map[string]any:
			instance.Context = v
		case string:
			json.Unmarshal([]byte(v), &instance.Context)
		}
	}

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
