package engine

import (
	"strings"
	"testing"

	"rocket-backend/internal/metadata"
)

func testStateMachine() *metadata.StateMachine {
	return &metadata.StateMachine{
		ID:     "sm-1",
		Entity: "invoice",
		Field:  "status",
		Active: true,
		Definition: metadata.StateMachineDefinition{
			Initial: "draft",
			Transitions: []metadata.Transition{
				{
					From:  metadata.TransitionFrom{"draft"},
					To:    "sent",
					Guard: "record.total > 0",
					Actions: []metadata.TransitionAction{
						{Type: "set_field", Field: "sent_at", Value: "now"},
					},
				},
				{
					From: metadata.TransitionFrom{"sent"},
					To:   "paid",
					Actions: []metadata.TransitionAction{
						{Type: "set_field", Field: "paid_at", Value: "now"},
					},
				},
				{
					From:    metadata.TransitionFrom{"draft", "sent"},
					To:      "void",
					Actions: []metadata.TransitionAction{},
				},
			},
		},
	}
}

func TestFindTransition(t *testing.T) {
	sm := testStateMachine()

	// draft → sent should match
	tr := FindTransition(sm, "draft", "sent")
	if tr == nil {
		t.Fatal("expected to find transition draft → sent")
	}
	if tr.To != "sent" {
		t.Errorf("expected to=sent, got %s", tr.To)
	}

	// sent → paid should match
	tr = FindTransition(sm, "sent", "paid")
	if tr == nil {
		t.Fatal("expected to find transition sent → paid")
	}

	// draft → void should match (array from)
	tr = FindTransition(sm, "draft", "void")
	if tr == nil {
		t.Fatal("expected to find transition draft → void")
	}

	// sent → void should match (array from)
	tr = FindTransition(sm, "sent", "void")
	if tr == nil {
		t.Fatal("expected to find transition sent → void")
	}

	// draft → paid should NOT match
	tr = FindTransition(sm, "draft", "paid")
	if tr != nil {
		t.Error("expected no transition draft → paid")
	}

	// void → draft should NOT match
	tr = FindTransition(sm, "void", "draft")
	if tr != nil {
		t.Error("expected no transition void → draft")
	}
}

func TestEvaluateGuard(t *testing.T) {
	transition := &metadata.Transition{
		From:  metadata.TransitionFrom{"draft"},
		To:    "sent",
		Guard: "record.total > 0",
	}

	// Guard passes (total > 0)
	env := map[string]any{
		"record": map[string]any{"total": 100},
		"old":    map[string]any{},
		"action": "update",
	}
	blocked, err := EvaluateGuard(transition, env)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if blocked {
		t.Error("expected guard to pass (not blocked)")
	}

	// Guard blocks (total = 0)
	transition.CompiledGuard = nil // reset cache
	env["record"] = map[string]any{"total": 0}
	blocked, err = EvaluateGuard(transition, env)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !blocked {
		t.Error("expected guard to block")
	}

	// Guard blocks (total negative)
	transition.CompiledGuard = nil
	env["record"] = map[string]any{"total": -5}
	blocked, err = EvaluateGuard(transition, env)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !blocked {
		t.Error("expected guard to block for negative total")
	}
}

func TestExecuteSetFieldAction(t *testing.T) {
	transition := &metadata.Transition{
		From: metadata.TransitionFrom{"draft"},
		To:   "sent",
		Actions: []metadata.TransitionAction{
			{Type: "set_field", Field: "sent_at", Value: "now"},
			{Type: "set_field", Field: "priority", Value: "high"},
		},
	}

	fields := map[string]any{"status": "sent"}
	ExecuteActions(transition, fields)

	// sent_at should be a timestamp string (not "now")
	sentAt, ok := fields["sent_at"].(string)
	if !ok {
		t.Fatal("expected sent_at to be a string")
	}
	if sentAt == "now" {
		t.Error("expected 'now' to be replaced with timestamp")
	}
	if !strings.Contains(sentAt, "T") {
		t.Errorf("expected RFC3339 timestamp, got %s", sentAt)
	}

	// priority should be set as-is
	if fields["priority"] != "high" {
		t.Errorf("expected priority=high, got %v", fields["priority"])
	}
}

func TestEvaluateStateMachine_ValidTransition(t *testing.T) {
	sm := testStateMachine()
	fields := map[string]any{"status": "sent", "total": 100}
	old := map[string]any{"status": "draft", "total": 100}

	errs := evaluateStateMachine(sm, fields, old, false)
	if len(errs) > 0 {
		t.Errorf("expected no errors, got %v", errs)
	}

	// set_field action should have set sent_at
	if _, ok := fields["sent_at"]; !ok {
		t.Error("expected sent_at to be set by action")
	}
}

func TestEvaluateStateMachine_InvalidTransition(t *testing.T) {
	sm := testStateMachine()
	fields := map[string]any{"status": "paid"}
	old := map[string]any{"status": "draft"}

	errs := evaluateStateMachine(sm, fields, old, false)
	if len(errs) == 0 {
		t.Fatal("expected validation error for invalid transition")
	}
	if !strings.Contains(errs[0].Message, "Invalid transition") {
		t.Errorf("expected invalid transition error, got %s", errs[0].Message)
	}
}

func TestEvaluateStateMachine_GuardFail(t *testing.T) {
	sm := testStateMachine()
	fields := map[string]any{"status": "sent", "total": 0}
	old := map[string]any{"status": "draft", "total": 0}

	errs := evaluateStateMachine(sm, fields, old, false)
	if len(errs) == 0 {
		t.Fatal("expected validation error for guard failure")
	}
	if !strings.Contains(errs[0].Message, "blocked by guard") {
		t.Errorf("expected guard blocked error, got %s", errs[0].Message)
	}
}

func TestEvaluateStateMachine_Create_ValidInitial(t *testing.T) {
	sm := testStateMachine()
	fields := map[string]any{"status": "draft"}

	errs := evaluateStateMachine(sm, fields, map[string]any{}, true)
	if len(errs) > 0 {
		t.Errorf("expected no errors for valid initial state, got %v", errs)
	}
}

func TestEvaluateStateMachine_Create_InvalidInitial(t *testing.T) {
	sm := testStateMachine()
	fields := map[string]any{"status": "sent"}

	errs := evaluateStateMachine(sm, fields, map[string]any{}, true)
	if len(errs) == 0 {
		t.Fatal("expected validation error for invalid initial state")
	}
	if !strings.Contains(errs[0].Message, "Initial state must be") {
		t.Errorf("expected initial state error, got %s", errs[0].Message)
	}
}

func TestEvaluateStateMachine_NoStateChange(t *testing.T) {
	sm := testStateMachine()
	fields := map[string]any{"status": "draft", "total": 50}
	old := map[string]any{"status": "draft"}

	errs := evaluateStateMachine(sm, fields, old, false)
	if len(errs) > 0 {
		t.Errorf("expected no errors when state doesn't change, got %v", errs)
	}
}

func TestEvaluateStateMachine_NoStateField(t *testing.T) {
	sm := testStateMachine()
	fields := map[string]any{"total": 100} // no "status" field
	old := map[string]any{"status": "draft"}

	errs := evaluateStateMachine(sm, fields, old, false)
	if len(errs) > 0 {
		t.Errorf("expected no errors when state field not in payload, got %v", errs)
	}
}
