package engine

import (
	"context"
	"fmt"
	"log"
	"time"

	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

// StepResult represents the outcome of executing a workflow step.
type StepResult struct {
	Paused   bool
	NextGoto string
}

// StepExecutorContext provides dependencies that step executors need.
type StepExecutorContext struct {
	ActionExecutors map[string]ActionExecutor
	Evaluator       ExpressionEvaluator
	Registry        *metadata.Registry
}

// StepExecutor handles execution of a single workflow step type.
type StepExecutor interface {
	Execute(ctx context.Context, q store.Querier, ectx *StepExecutorContext, instance *metadata.WorkflowInstance, step *metadata.WorkflowStep) (*StepResult, error)
}

// ActionStepExecutor runs all actions in an action step sequentially.
type ActionStepExecutor struct{}

func (e *ActionStepExecutor) Execute(ctx context.Context, q store.Querier, ectx *StepExecutorContext,
	instance *metadata.WorkflowInstance, step *metadata.WorkflowStep) (*StepResult, error) {

	for _, action := range step.Actions {
		executor, ok := ectx.ActionExecutors[action.Type]
		if !ok {
			log.Printf("WARN: unknown workflow action type: %s", action.Type)
			continue
		}
		if err := executor.Execute(ctx, q, ectx.Registry, instance, &action); err != nil {
			return nil, fmt.Errorf("action %s: %w", action.Type, err)
		}
	}

	instance.History = append(instance.History, metadata.WorkflowHistoryEntry{
		Step:   step.ID,
		Status: "completed",
		At:     time.Now().UTC().Format(time.RFC3339),
	})

	next := ""
	if step.Then != nil {
		next = step.Then.Goto
	}
	return &StepResult{Paused: false, NextGoto: next}, nil
}

// ConditionStepExecutor evaluates a boolean expression and branches.
type ConditionStepExecutor struct{}

func (e *ConditionStepExecutor) Execute(_ context.Context, _ store.Querier, ectx *StepExecutorContext,
	instance *metadata.WorkflowInstance, step *metadata.WorkflowStep) (*StepResult, error) {

	if step.Expression == "" {
		return nil, fmt.Errorf("condition step %s has no expression", step.ID)
	}

	env := map[string]any{
		"context": instance.Context,
	}

	isTrue, err := ectx.Evaluator.EvaluateBool(step.Expression, env)
	if err != nil {
		return nil, err
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

	return &StepResult{Paused: false, NextGoto: next}, nil
}

// ApprovalStepExecutor pauses the workflow and optionally sets a deadline.
type ApprovalStepExecutor struct{}

func (e *ApprovalStepExecutor) Execute(_ context.Context, _ store.Querier, _ *StepExecutorContext,
	instance *metadata.WorkflowInstance, step *metadata.WorkflowStep) (*StepResult, error) {

	if step.Timeout != "" {
		duration, err := time.ParseDuration(step.Timeout)
		if err == nil {
			deadline := time.Now().UTC().Add(duration).Format(time.RFC3339)
			instance.CurrentStepDeadline = &deadline
		}
	}

	return &StepResult{Paused: true, NextGoto: ""}, nil
}

// DefaultStepExecutors returns the built-in set of step executors.
func DefaultStepExecutors() map[string]StepExecutor {
	return map[string]StepExecutor{
		"action":    &ActionStepExecutor{},
		"condition": &ConditionStepExecutor{},
		"approval":  &ApprovalStepExecutor{},
	}
}
