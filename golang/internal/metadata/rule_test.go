package metadata

import (
	"encoding/json"
	"testing"
)

func TestRuleParsing_FieldRule(t *testing.T) {
	raw := `{
		"field": "total",
		"operator": "min",
		"value": 0,
		"message": "Total must be non-negative"
	}`
	var def RuleDefinition
	if err := json.Unmarshal([]byte(raw), &def); err != nil {
		t.Fatalf("parse field rule: %v", err)
	}
	if def.Field != "total" {
		t.Fatalf("expected field=total, got %s", def.Field)
	}
	if def.Operator != "min" {
		t.Fatalf("expected operator=min, got %s", def.Operator)
	}
	if def.Value != float64(0) {
		t.Fatalf("expected value=0, got %v", def.Value)
	}
	if def.Message != "Total must be non-negative" {
		t.Fatalf("expected message, got %s", def.Message)
	}
}

func TestRuleParsing_ExpressionRule(t *testing.T) {
	raw := `{
		"expression": "record.status == 'paid' && record.payment_date == nil",
		"message": "Payment date is required when status is paid",
		"stop_on_fail": true,
		"related_load": [{"relation": "items"}]
	}`
	var def RuleDefinition
	if err := json.Unmarshal([]byte(raw), &def); err != nil {
		t.Fatalf("parse expression rule: %v", err)
	}
	if def.Expression != "record.status == 'paid' && record.payment_date == nil" {
		t.Fatalf("expression mismatch: %s", def.Expression)
	}
	if !def.StopOnFail {
		t.Fatal("expected stop_on_fail=true")
	}
	if len(def.RelatedLoad) != 1 {
		t.Fatalf("expected 1 related_load, got %d", len(def.RelatedLoad))
	}
	if def.RelatedLoad[0].Relation != "items" {
		t.Fatalf("expected relation=items, got %s", def.RelatedLoad[0].Relation)
	}
}

func TestRuleParsing_ComputedField(t *testing.T) {
	raw := `{
		"field": "total",
		"expression": "record.subtotal * (1 + record.tax_rate)"
	}`
	var def RuleDefinition
	if err := json.Unmarshal([]byte(raw), &def); err != nil {
		t.Fatalf("parse computed rule: %v", err)
	}
	if def.Field != "total" {
		t.Fatalf("expected field=total, got %s", def.Field)
	}
	if def.Expression != "record.subtotal * (1 + record.tax_rate)" {
		t.Fatalf("expression mismatch: %s", def.Expression)
	}
}

func TestRule_FullStruct(t *testing.T) {
	rule := &Rule{
		ID:       "test-id",
		Entity:   "invoice",
		Hook:     "before_write",
		Type:     "field",
		Priority: 10,
		Active:   true,
		Definition: RuleDefinition{
			Field:    "total",
			Operator: "min",
			Value:    float64(0),
			Message:  "Total must be non-negative",
		},
	}
	if rule.Entity != "invoice" {
		t.Fatalf("expected entity=invoice, got %s", rule.Entity)
	}
	if rule.Type != "field" {
		t.Fatalf("expected type=field, got %s", rule.Type)
	}
}

func TestRegistryGetRulesForEntity(t *testing.T) {
	reg := NewRegistry()
	rules := []*Rule{
		{ID: "1", Entity: "invoice", Hook: "before_write", Type: "field", Active: true},
		{ID: "2", Entity: "invoice", Hook: "before_write", Type: "expression", Active: true},
		{ID: "3", Entity: "invoice", Hook: "before_delete", Type: "expression", Active: true},
		{ID: "4", Entity: "customer", Hook: "before_write", Type: "field", Active: true},
		{ID: "5", Entity: "invoice", Hook: "before_write", Type: "field", Active: false},
	}
	reg.LoadRules(rules)

	beforeWrite := reg.GetRulesForEntity("invoice", "before_write")
	if len(beforeWrite) != 2 {
		t.Fatalf("expected 2 active before_write rules for invoice, got %d", len(beforeWrite))
	}

	beforeDelete := reg.GetRulesForEntity("invoice", "before_delete")
	if len(beforeDelete) != 1 {
		t.Fatalf("expected 1 before_delete rule for invoice, got %d", len(beforeDelete))
	}

	customerRules := reg.GetRulesForEntity("customer", "before_write")
	if len(customerRules) != 1 {
		t.Fatalf("expected 1 rule for customer, got %d", len(customerRules))
	}

	noRules := reg.GetRulesForEntity("nonexistent", "before_write")
	if len(noRules) != 0 {
		t.Fatalf("expected 0 rules for nonexistent, got %d", len(noRules))
	}
}
