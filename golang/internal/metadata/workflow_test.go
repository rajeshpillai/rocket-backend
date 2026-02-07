package metadata

import (
	"encoding/json"
	"testing"
)

func TestStepGotoUnmarshalObject(t *testing.T) {
	raw := `{"goto": "check_amount"}`
	var sg StepGoto
	if err := json.Unmarshal([]byte(raw), &sg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if sg.Goto != "check_amount" {
		t.Errorf("expected goto=check_amount, got %s", sg.Goto)
	}
}

func TestStepGotoUnmarshalEnd(t *testing.T) {
	raw := `"end"`
	var sg StepGoto
	if err := json.Unmarshal([]byte(raw), &sg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if sg.Goto != "end" {
		t.Errorf("expected goto=end, got %s", sg.Goto)
	}
}

func TestStepGotoMarshalObject(t *testing.T) {
	sg := StepGoto{Goto: "check_amount"}
	data, err := json.Marshal(sg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	expected := `{"goto":"check_amount"}`
	if string(data) != expected {
		t.Errorf("expected %s, got %s", expected, string(data))
	}
}

func TestStepGotoMarshalEnd(t *testing.T) {
	sg := StepGoto{Goto: "end"}
	data, err := json.Marshal(sg)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(data) != `"end"` {
		t.Errorf("expected \"end\", got %s", string(data))
	}
}

func TestWorkflowParseFullJSON(t *testing.T) {
	raw := `{
		"id": "wf-001",
		"name": "purchase_order_approval",
		"trigger": {
			"type": "state_change",
			"entity": "purchase_order",
			"field": "status",
			"to": "pending_approval"
		},
		"context": {
			"record_id": "trigger.record_id",
			"amount": "trigger.record.amount"
		},
		"steps": [
			{
				"id": "manager_approval",
				"type": "approval",
				"assignee": { "type": "role", "role": "manager" },
				"timeout": "72h",
				"on_approve": { "goto": "check_amount" },
				"on_reject": { "goto": "rejected" },
				"on_timeout": { "goto": "escalate" }
			},
			{
				"id": "check_amount",
				"type": "condition",
				"expression": "context.amount > 10000",
				"on_true": { "goto": "finance_approval" },
				"on_false": { "goto": "approved" }
			},
			{
				"id": "finance_approval",
				"type": "approval",
				"assignee": { "type": "role", "role": "finance_manager" },
				"timeout": "48h",
				"on_approve": { "goto": "approved" },
				"on_reject": { "goto": "rejected" }
			},
			{
				"id": "approved",
				"type": "action",
				"actions": [
					{ "type": "set_field", "entity": "purchase_order", "record_id": "context.record_id", "field": "status", "value": "approved" }
				],
				"then": "end"
			},
			{
				"id": "rejected",
				"type": "action",
				"actions": [
					{ "type": "set_field", "entity": "purchase_order", "record_id": "context.record_id", "field": "status", "value": "rejected" }
				],
				"then": "end"
			}
		],
		"active": true
	}`

	var wf Workflow
	if err := json.Unmarshal([]byte(raw), &wf); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if wf.ID != "wf-001" {
		t.Errorf("expected id=wf-001, got %s", wf.ID)
	}
	if wf.Name != "purchase_order_approval" {
		t.Errorf("expected name=purchase_order_approval, got %s", wf.Name)
	}
	if wf.Trigger.Type != "state_change" {
		t.Errorf("expected trigger.type=state_change, got %s", wf.Trigger.Type)
	}
	if wf.Trigger.Entity != "purchase_order" {
		t.Errorf("expected trigger.entity=purchase_order, got %s", wf.Trigger.Entity)
	}
	if wf.Trigger.To != "pending_approval" {
		t.Errorf("expected trigger.to=pending_approval, got %s", wf.Trigger.To)
	}
	if len(wf.Context) != 2 {
		t.Fatalf("expected 2 context mappings, got %d", len(wf.Context))
	}
	if wf.Context["record_id"] != "trigger.record_id" {
		t.Errorf("expected context[record_id]=trigger.record_id, got %s", wf.Context["record_id"])
	}
	if len(wf.Steps) != 5 {
		t.Fatalf("expected 5 steps, got %d", len(wf.Steps))
	}

	// Approval step
	s0 := wf.Steps[0]
	if s0.ID != "manager_approval" || s0.Type != "approval" {
		t.Errorf("unexpected step 0: id=%s type=%s", s0.ID, s0.Type)
	}
	if s0.Assignee == nil || s0.Assignee.Role != "manager" {
		t.Errorf("expected assignee role=manager")
	}
	if s0.Timeout != "72h" {
		t.Errorf("expected timeout=72h, got %s", s0.Timeout)
	}
	if s0.OnApprove == nil || s0.OnApprove.Goto != "check_amount" {
		t.Errorf("expected on_approve.goto=check_amount")
	}
	if s0.OnReject == nil || s0.OnReject.Goto != "rejected" {
		t.Errorf("expected on_reject.goto=rejected")
	}

	// Condition step
	s1 := wf.Steps[1]
	if s1.Type != "condition" || s1.Expression != "context.amount > 10000" {
		t.Errorf("unexpected condition step: type=%s expr=%s", s1.Type, s1.Expression)
	}
	if s1.OnTrue == nil || s1.OnTrue.Goto != "finance_approval" {
		t.Errorf("expected on_true.goto=finance_approval")
	}
	if s1.OnFalse == nil || s1.OnFalse.Goto != "approved" {
		t.Errorf("expected on_false.goto=approved")
	}

	// Action step with then="end"
	s3 := wf.Steps[3]
	if s3.Type != "action" || s3.ID != "approved" {
		t.Errorf("unexpected action step: id=%s type=%s", s3.ID, s3.Type)
	}
	if s3.Then == nil || s3.Then.Goto != "end" {
		t.Errorf("expected then=end")
	}
	if len(s3.Actions) != 1 {
		t.Fatalf("expected 1 action, got %d", len(s3.Actions))
	}
	if s3.Actions[0].Type != "set_field" || s3.Actions[0].Field != "status" {
		t.Errorf("unexpected action: %+v", s3.Actions[0])
	}
}

func TestWorkflowFindStep(t *testing.T) {
	wf := Workflow{
		Steps: []WorkflowStep{
			{ID: "step1", Type: "action"},
			{ID: "step2", Type: "condition"},
			{ID: "step3", Type: "approval"},
		},
	}

	s := wf.FindStep("step2")
	if s == nil {
		t.Fatal("expected to find step2")
	}
	if s.Type != "condition" {
		t.Errorf("expected type=condition, got %s", s.Type)
	}

	s = wf.FindStep("nonexistent")
	if s != nil {
		t.Error("expected nil for nonexistent step")
	}
}

func TestWorkflowMarshalRoundTrip(t *testing.T) {
	wf := Workflow{
		Name: "test_wf",
		Trigger: WorkflowTrigger{
			Type:   "state_change",
			Entity: "order",
			Field:  "status",
			To:     "approved",
		},
		Context: map[string]string{"id": "trigger.record_id"},
		Steps: []WorkflowStep{
			{
				ID:   "auto_approve",
				Type: "action",
				Actions: []WorkflowAction{
					{Type: "set_field", Entity: "order", Field: "approved", Value: true},
				},
				Then: &StepGoto{Goto: "end"},
			},
		},
		Active: true,
	}

	data, err := json.Marshal(wf)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var wf2 Workflow
	if err := json.Unmarshal(data, &wf2); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if wf2.Name != "test_wf" {
		t.Errorf("expected name=test_wf, got %s", wf2.Name)
	}
	if len(wf2.Steps) != 1 {
		t.Fatalf("expected 1 step, got %d", len(wf2.Steps))
	}
	if wf2.Steps[0].Then == nil || wf2.Steps[0].Then.Goto != "end" {
		t.Errorf("expected then=end after round-trip")
	}
}

func TestRegistryWorkflows(t *testing.T) {
	reg := NewRegistry()

	workflows := []*Workflow{
		{
			ID:   "1",
			Name: "po_approval",
			Trigger: WorkflowTrigger{
				Type: "state_change", Entity: "purchase_order",
				Field: "status", To: "pending",
			},
			Active: true,
		},
		{
			ID:   "2",
			Name: "inactive_wf",
			Trigger: WorkflowTrigger{
				Type: "state_change", Entity: "purchase_order",
				Field: "status", To: "pending",
			},
			Active: false,
		},
		{
			ID:   "3",
			Name: "order_wf",
			Trigger: WorkflowTrigger{
				Type: "state_change", Entity: "order",
				Field: "status", To: "shipped",
			},
			Active: true,
		},
	}

	reg.LoadWorkflows(workflows)

	// Should only return active workflows
	poWFs := reg.GetWorkflowsForTrigger("purchase_order", "status", "pending")
	if len(poWFs) != 1 {
		t.Errorf("expected 1 active workflow for purchase_order:status:pending, got %d", len(poWFs))
	}
	if poWFs[0].Name != "po_approval" {
		t.Errorf("expected name=po_approval, got %s", poWFs[0].Name)
	}

	orderWFs := reg.GetWorkflowsForTrigger("order", "status", "shipped")
	if len(orderWFs) != 1 {
		t.Errorf("expected 1 workflow for order:status:shipped, got %d", len(orderWFs))
	}

	noneWFs := reg.GetWorkflowsForTrigger("nonexistent", "status", "active")
	if len(noneWFs) != 0 {
		t.Errorf("expected 0 workflows, got %d", len(noneWFs))
	}

	// GetWorkflow by name
	wf := reg.GetWorkflow("po_approval")
	if wf == nil {
		t.Fatal("expected to find po_approval")
	}
	if wf.ID != "1" {
		t.Errorf("expected id=1, got %s", wf.ID)
	}

	wf = reg.GetWorkflow("nonexistent")
	if wf != nil {
		t.Error("expected nil for nonexistent workflow")
	}
}
