package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/expr-lang/expr"
	"github.com/expr-lang/expr/vm"

	"rocket-backend/internal/instrument"
	"rocket-backend/internal/metadata"
)

// EvaluateStateMachines checks all active state machines for the entity.
// Returns validation errors if a transition is invalid or a guard fails.
// Mutates fields with set_field actions on successful transitions.
func EvaluateStateMachines(ctx context.Context, reg *metadata.Registry, entityName string, fields map[string]any, old map[string]any, isCreate bool) []ErrorDetail {
	_, span := instrument.GetInstrumenter(ctx).StartSpan(ctx, "engine", "state_machine", "state.transition")
	defer span.End()
	span.SetEntity(entityName, "")

	machines := reg.GetStateMachinesForEntity(entityName)
	if len(machines) == 0 {
		span.SetStatus("ok")
		return nil
	}

	var errs []ErrorDetail

	for _, sm := range machines {
		smErrs := evaluateStateMachine(sm, fields, old, isCreate)
		errs = append(errs, smErrs...)
	}

	if len(errs) > 0 {
		span.SetStatus("error")
	} else {
		span.SetStatus("ok")
	}
	return errs
}

func evaluateStateMachine(sm *metadata.StateMachine, fields map[string]any, old map[string]any, isCreate bool) []ErrorDetail {
	newState, hasNewState := fields[sm.Field]
	if !hasNewState {
		return nil // state field not in payload, no transition
	}

	newStateStr := fmt.Sprintf("%v", newState)

	if isCreate {
		// On create, validate initial state if defined
		if sm.Definition.Initial != "" && newStateStr != sm.Definition.Initial {
			return []ErrorDetail{{
				Field:   sm.Field,
				Rule:    "state_machine",
				Message: fmt.Sprintf("Initial state must be '%s', got '%s'", sm.Definition.Initial, newStateStr),
			}}
		}
		// Execute actions for initial state (find a transition with empty from or skip)
		return nil
	}

	// Update: find matching transition
	oldState := ""
	if v, ok := old[sm.Field]; ok && v != nil {
		oldState = fmt.Sprintf("%v", v)
	}

	if oldState == newStateStr {
		return nil // no state change
	}

	transition := FindTransition(sm, oldState, newStateStr)
	if transition == nil {
		return []ErrorDetail{{
			Field:   sm.Field,
			Rule:    "state_machine",
			Message: fmt.Sprintf("Invalid transition from '%s' to '%s'", oldState, newStateStr),
		}}
	}

	// Evaluate guard
	if transition.Guard != "" {
		env := map[string]any{
			"record": fields,
			"old":    old,
			"action": "update",
		}
		blocked, err := EvaluateGuard(transition, env)
		if err != nil {
			return []ErrorDetail{{
				Field:   sm.Field,
				Rule:    "state_machine",
				Message: fmt.Sprintf("Guard evaluation error: %v", err),
			}}
		}
		if blocked {
			msg := fmt.Sprintf("Transition from '%s' to '%s' blocked by guard", oldState, newStateStr)
			return []ErrorDetail{{
				Field:   sm.Field,
				Rule:    "state_machine",
				Message: msg,
			}}
		}
	}

	// Execute actions
	ExecuteActions(transition, fields)

	return nil
}

// FindTransition finds a matching transition for the given old and new state.
func FindTransition(sm *metadata.StateMachine, oldState, newState string) *metadata.Transition {
	for i := range sm.Definition.Transitions {
		t := &sm.Definition.Transitions[i]
		if t.To != newState {
			continue
		}
		for _, from := range t.From {
			if from == oldState {
				return t
			}
		}
	}
	return nil
}

// EvaluateGuard compiles and runs a guard expression.
// Returns true if the guard BLOCKS the transition (expression evaluates to false).
// Guard semantics: expression returns true = transition allowed, false = blocked.
func EvaluateGuard(transition *metadata.Transition, env map[string]any) (bool, error) {
	prog, ok := transition.CompiledGuard.(*vm.Program)
	if !ok || prog == nil {
		compiled, err := expr.Compile(transition.Guard, expr.AsBool())
		if err != nil {
			return false, fmt.Errorf("compile guard: %w", err)
		}
		transition.CompiledGuard = compiled
		prog = compiled
	}

	result, err := expr.Run(prog, env)
	if err != nil {
		return false, fmt.Errorf("evaluate guard: %w", err)
	}

	allowed, ok := result.(bool)
	if !ok {
		return false, fmt.Errorf("guard did not return bool")
	}

	return !allowed, nil // blocked = !allowed
}

// ExecuteActions runs transition actions, mutating fields for set_field actions.
func ExecuteActions(transition *metadata.Transition, fields map[string]any) {
	for _, action := range transition.Actions {
		switch action.Type {
		case "set_field":
			val := action.Value
			if s, ok := val.(string); ok && s == "now" {
				val = time.Now().UTC().Format(time.RFC3339)
			}
			fields[action.Field] = val

		case "webhook":
			go func(a metadata.TransitionAction) {
				body, _ := json.Marshal(fields)
				result := DispatchWebhookDirect(context.Background(), a.URL, a.Method, nil, body)
				if result.Error != "" {
					log.Printf("WARN: state machine webhook %s %s failed: %s", a.Method, a.URL, result.Error)
				} else if result.StatusCode < 200 || result.StatusCode >= 300 {
					log.Printf("WARN: state machine webhook %s %s returned HTTP %d", a.Method, a.URL, result.StatusCode)
				}
			}(action)

		case "create_record":
			log.Printf("STUB: create_record action for entity %s (not yet implemented)", action.Entity)

		case "send_event":
			log.Printf("STUB: send_event action '%s' (not yet implemented)", action.Event)
		}
	}
}
