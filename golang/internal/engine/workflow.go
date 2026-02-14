package engine

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"rocket-backend/internal/instrument"
	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

// WFEngine orchestrates workflow lifecycle: triggering, step advancement,
// approval resolution, and timeout handling. All dependencies are injected.
type WFEngine struct {
	wfStore         WorkflowStore
	registry        *metadata.Registry
	pool            store.Querier
	stepExecutors   map[string]StepExecutor
	actionExecutors map[string]ActionExecutor
	evaluator       ExpressionEvaluator
}

// NewWFEngine creates a WFEngine with the given dependencies.
func NewWFEngine(
	pool store.Querier,
	registry *metadata.Registry,
	wfStore WorkflowStore,
	stepExecutors map[string]StepExecutor,
	actionExecutors map[string]ActionExecutor,
	evaluator ExpressionEvaluator,
) *WFEngine {
	return &WFEngine{
		pool:            pool,
		registry:        registry,
		wfStore:         wfStore,
		stepExecutors:   stepExecutors,
		actionExecutors: actionExecutors,
		evaluator:       evaluator,
	}
}

// NewDefaultWFEngine creates a WFEngine with default executors and Postgres store.
func NewDefaultWFEngine(s *store.Store, reg *metadata.Registry) *WFEngine {
	return NewWFEngine(
		s.Pool,
		reg,
		&PgWorkflowStore{},
		DefaultStepExecutors(),
		DefaultActionExecutors(),
		NewExprLangEvaluator(),
	)
}

// TriggerWorkflowsViaEngine checks if any active workflows match the state
// transition and starts them.
func (e *WFEngine) TriggerWorkflowsViaEngine(ctx context.Context,
	entity, field, toState string, record map[string]any, recordID any) {

	ctx, span := instrument.GetInstrumenter(ctx).StartSpan(ctx, "workflow", "engine", "workflow.trigger")
	defer span.End()
	span.SetEntity(entity, fmt.Sprintf("%v", recordID))
	span.SetMetadata("field", field)
	span.SetMetadata("to_state", toState)

	workflows := e.registry.GetWorkflowsForTrigger(entity, field, toState)
	if len(workflows) == 0 {
		span.SetStatus("ok")
		return
	}

	hasError := false
	for _, wf := range workflows {
		if err := e.createInstance(ctx, wf, record, recordID); err != nil {
			log.Printf("ERROR: failed to create workflow instance for %s: %v", wf.Name, err)
			hasError = true
		}
	}

	if hasError {
		span.SetStatus("error")
	} else {
		span.SetStatus("ok")
	}
}

// ResolveAction handles approve/reject on a paused workflow instance.
func (e *WFEngine) ResolveAction(ctx context.Context,
	instanceID string, action string, userID string) (*metadata.WorkflowInstance, error) {

	instance, err := e.wfStore.LoadInstance(ctx, e.pool, instanceID)
	if err != nil {
		return nil, err
	}

	if instance.Status != "running" {
		return nil, fmt.Errorf("workflow instance is not running (status: %s)", instance.Status)
	}

	wf := e.registry.GetWorkflow(instance.WorkflowName)
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

	instance.History = append(instance.History, metadata.WorkflowHistoryEntry{
		Step:   step.ID,
		Status: action,
		By:     userID,
		At:     time.Now().UTC().Format(time.RFC3339),
	})
	instance.CurrentStepDeadline = nil

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
		if err := e.wfStore.PersistInstance(ctx, e.pool, instance); err != nil {
			return nil, err
		}
		return instance, nil
	}

	instance.CurrentStep = nextGoto
	if err := e.advanceWorkflow(ctx, instance, wf); err != nil {
		return nil, err
	}

	return e.wfStore.LoadInstance(ctx, e.pool, instance.ID)
}

// ProcessTimeouts finds and handles timed-out workflow instances.
func (e *WFEngine) ProcessTimeouts(ctx context.Context) {
	instances, err := e.wfStore.FindTimedOut(ctx, e.pool)
	if err != nil {
		log.Printf("ERROR: workflow timeout query failed: %v", err)
		return
	}

	for _, instance := range instances {
		if err := e.handleTimeout(ctx, instance); err != nil {
			log.Printf("ERROR: processing timeout for instance %s: %v", instance.ID, err)
		}
	}
}

// ── Internal ──

func (e *WFEngine) createInstance(ctx context.Context,
	wf *metadata.Workflow, record map[string]any, recordID any) error {

	wfCtx := buildWorkflowContext(wf.Context, record, recordID)

	if len(wf.Steps) == 0 {
		return fmt.Errorf("workflow %s has no steps", wf.Name)
	}

	firstStepID := wf.Steps[0].ID

	instanceID, err := e.wfStore.CreateInstance(ctx, e.pool, WorkflowInstanceData{
		WorkflowID:   wf.ID,
		WorkflowName: wf.Name,
		CurrentStep:  firstStepID,
		Context:      wfCtx,
	})
	if err != nil {
		return err
	}

	instance := &metadata.WorkflowInstance{
		ID:           instanceID,
		WorkflowID:   wf.ID,
		WorkflowName: wf.Name,
		Status:       "running",
		CurrentStep:  firstStepID,
		Context:      wfCtx,
		History:      []metadata.WorkflowHistoryEntry{},
	}

	log.Printf("Created workflow instance %s for workflow %s", instance.ID, wf.Name)

	return e.advanceWorkflow(ctx, instance, wf)
}

func (e *WFEngine) advanceWorkflow(ctx context.Context,
	instance *metadata.WorkflowInstance, wf *metadata.Workflow) error {

	ctx, span := instrument.GetInstrumenter(ctx).StartSpan(ctx, "workflow", "engine", "workflow.advance")
	defer span.End()
	span.SetMetadata("workflow", wf.Name)
	span.SetMetadata("instance_id", instance.ID)

	stepCtx := &StepExecutorContext{
		ActionExecutors: e.actionExecutors,
		Evaluator:       e.evaluator,
		Registry:        e.registry,
	}

	for {
		if instance.Status != "running" {
			span.SetStatus("ok")
			return nil
		}

		step := wf.FindStep(instance.CurrentStep)
		if step == nil {
			instance.Status = "failed"
			span.SetStatus("error")
			span.SetMetadata("error", "step not found")
			return e.wfStore.PersistInstance(ctx, e.pool, instance)
		}

		executor, ok := e.stepExecutors[step.Type]
		if !ok {
			span.SetStatus("error")
			span.SetMetadata("error", fmt.Sprintf("unknown step type: %s", step.Type))
			return fmt.Errorf("unknown step type: %s", step.Type)
		}

		result, err := executor.Execute(ctx, e.pool, stepCtx, instance, step)
		if err != nil {
			log.Printf("ERROR: workflow %s step %s failed: %v", wf.Name, step.ID, err)
			instance.Status = "failed"
			span.SetStatus("error")
			span.SetMetadata("error", err.Error())
			return e.wfStore.PersistInstance(ctx, e.pool, instance)
		}

		if result.Paused {
			span.SetStatus("ok")
			span.SetMetadata("paused_at", instance.CurrentStep)
			return e.wfStore.PersistInstance(ctx, e.pool, instance)
		}

		if result.NextGoto == "" || result.NextGoto == "end" {
			instance.Status = "completed"
			instance.CurrentStep = ""
			span.SetStatus("ok")
			return e.wfStore.PersistInstance(ctx, e.pool, instance)
		}

		instance.CurrentStep = result.NextGoto
	}
}

func (e *WFEngine) handleTimeout(ctx context.Context, instance *metadata.WorkflowInstance) error {
	wf := e.registry.GetWorkflow(instance.WorkflowName)
	if wf == nil {
		log.Printf("WARN: workflow definition not found for timed-out instance %s: %s", instance.ID, instance.WorkflowName)
		return nil
	}

	step := wf.FindStep(instance.CurrentStep)
	if step == nil || step.Type != "approval" {
		return nil
	}

	log.Printf("Workflow instance %s step %s timed out", instance.ID, step.ID)

	instance.History = append(instance.History, metadata.WorkflowHistoryEntry{
		Step:   instance.CurrentStep,
		Status: "timed_out",
		At:     time.Now().UTC().Format(time.RFC3339),
	})
	instance.CurrentStepDeadline = nil

	nextGoto := ""
	if step.OnTimeout != nil {
		nextGoto = step.OnTimeout.Goto
	}

	if nextGoto == "" || nextGoto == "end" {
		if nextGoto == "end" {
			instance.Status = "completed"
		} else {
			instance.Status = "failed"
		}
		instance.CurrentStep = ""
		return e.wfStore.PersistInstance(ctx, e.pool, instance)
	}

	instance.CurrentStep = nextGoto
	return e.advanceWorkflow(ctx, instance, wf)
}

// ── Backward-compatible free functions ──
// These preserve the existing call signatures used by nested_write.go,
// workflow_handler.go, and multiapp scheduler.

// TriggerWorkflows checks if any active workflows should be started based on
// a state transition. Called after a successful write commit.
func TriggerWorkflows(ctx context.Context, s *store.Store, reg *metadata.Registry,
	entity, field, toState string, record map[string]any, recordID any) {
	engine := NewDefaultWFEngine(s, reg)
	engine.TriggerWorkflowsViaEngine(ctx, entity, field, toState, record, recordID)
}

// ResolveWorkflowAction handles approve/reject on a paused workflow instance.
func ResolveWorkflowAction(ctx context.Context, s *store.Store, reg *metadata.Registry,
	instanceID string, action string, userID string) (*metadata.WorkflowInstance, error) {
	engine := NewDefaultWFEngine(s, reg)
	return engine.ResolveAction(ctx, instanceID, action, userID)
}

// ListPendingInstances returns workflow instances that are running (awaiting approval).
func ListPendingInstances(ctx context.Context, s *store.Store) ([]*metadata.WorkflowInstance, error) {
	wfStore := &PgWorkflowStore{}
	return wfStore.ListPending(ctx, s.Pool)
}

// ── Context helpers ──

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

func resolveContextPath(data map[string]any, path string) any {
	if path == "" {
		return nil
	}

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
