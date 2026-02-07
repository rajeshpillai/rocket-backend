package metadata

import (
	"encoding/json"
	"testing"
)

func TestStateMachineParseFromJSON(t *testing.T) {
	raw := `{
		"initial": "draft",
		"transitions": [
			{
				"from": "draft",
				"to": "sent",
				"roles": ["admin", "accountant"],
				"guard": "record.total > 0",
				"actions": [
					{ "type": "set_field", "field": "sent_at", "value": "now" }
				]
			},
			{
				"from": ["draft", "sent"],
				"to": "void",
				"roles": ["admin"],
				"actions": [
					{ "type": "set_field", "field": "voided_at", "value": "now" }
				]
			}
		]
	}`

	var def StateMachineDefinition
	if err := json.Unmarshal([]byte(raw), &def); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if def.Initial != "draft" {
		t.Errorf("expected initial=draft, got %s", def.Initial)
	}
	if len(def.Transitions) != 2 {
		t.Fatalf("expected 2 transitions, got %d", len(def.Transitions))
	}

	// First transition: "from" is a single string
	tr0 := def.Transitions[0]
	if len(tr0.From) != 1 || tr0.From[0] != "draft" {
		t.Errorf("expected from=[draft], got %v", tr0.From)
	}
	if tr0.To != "sent" {
		t.Errorf("expected to=sent, got %s", tr0.To)
	}
	if len(tr0.Roles) != 2 {
		t.Errorf("expected 2 roles, got %d", len(tr0.Roles))
	}
	if tr0.Guard != "record.total > 0" {
		t.Errorf("expected guard, got %s", tr0.Guard)
	}
	if len(tr0.Actions) != 1 {
		t.Fatalf("expected 1 action, got %d", len(tr0.Actions))
	}
	if tr0.Actions[0].Type != "set_field" || tr0.Actions[0].Field != "sent_at" || tr0.Actions[0].Value != "now" {
		t.Errorf("unexpected action: %+v", tr0.Actions[0])
	}

	// Second transition: "from" is an array
	tr1 := def.Transitions[1]
	if len(tr1.From) != 2 || tr1.From[0] != "draft" || tr1.From[1] != "sent" {
		t.Errorf("expected from=[draft, sent], got %v", tr1.From)
	}
	if tr1.To != "void" {
		t.Errorf("expected to=void, got %s", tr1.To)
	}
}

func TestStateMachineFullStruct(t *testing.T) {
	raw := `{
		"id": "abc-123",
		"entity": "invoice",
		"field": "status",
		"definition": {
			"initial": "draft",
			"transitions": [
				{
					"from": "draft",
					"to": "sent",
					"guard": "record.total > 0"
				}
			]
		},
		"active": true
	}`

	var sm StateMachine
	if err := json.Unmarshal([]byte(raw), &sm); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if sm.ID != "abc-123" {
		t.Errorf("expected id=abc-123, got %s", sm.ID)
	}
	if sm.Entity != "invoice" {
		t.Errorf("expected entity=invoice, got %s", sm.Entity)
	}
	if sm.Field != "status" {
		t.Errorf("expected field=status, got %s", sm.Field)
	}
	if !sm.Active {
		t.Error("expected active=true")
	}
	if sm.Definition.Initial != "draft" {
		t.Errorf("expected initial=draft, got %s", sm.Definition.Initial)
	}
	if len(sm.Definition.Transitions) != 1 {
		t.Fatalf("expected 1 transition, got %d", len(sm.Definition.Transitions))
	}
}

func TestTransitionFromMarshalSingle(t *testing.T) {
	tf := TransitionFrom{"draft"}
	data, err := json.Marshal(tf)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(data) != `"draft"` {
		t.Errorf("expected \"draft\", got %s", string(data))
	}
}

func TestTransitionFromMarshalArray(t *testing.T) {
	tf := TransitionFrom{"draft", "sent"}
	data, err := json.Marshal(tf)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(data) != `["draft","sent"]` {
		t.Errorf("expected [\"draft\",\"sent\"], got %s", string(data))
	}
}

func TestRegistryStateMachines(t *testing.T) {
	reg := NewRegistry()

	machines := []*StateMachine{
		{ID: "1", Entity: "invoice", Field: "status", Active: true,
			Definition: StateMachineDefinition{Initial: "draft"}},
		{ID: "2", Entity: "invoice", Field: "stage", Active: false,
			Definition: StateMachineDefinition{Initial: "new"}},
		{ID: "3", Entity: "order", Field: "status", Active: true,
			Definition: StateMachineDefinition{Initial: "pending"}},
	}

	reg.LoadStateMachines(machines)

	invoiceSMs := reg.GetStateMachinesForEntity("invoice")
	if len(invoiceSMs) != 1 {
		t.Errorf("expected 1 active state machine for invoice, got %d", len(invoiceSMs))
	}
	if invoiceSMs[0].Field != "status" {
		t.Errorf("expected field=status, got %s", invoiceSMs[0].Field)
	}

	orderSMs := reg.GetStateMachinesForEntity("order")
	if len(orderSMs) != 1 {
		t.Errorf("expected 1 active state machine for order, got %d", len(orderSMs))
	}

	emptySMs := reg.GetStateMachinesForEntity("nonexistent")
	if len(emptySMs) != 0 {
		t.Errorf("expected 0 state machines, got %d", len(emptySMs))
	}
}
