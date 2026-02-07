package engine

import (
	"testing"

	"rocket-backend/internal/metadata"
)

func TestEvaluateFieldRule_Min(t *testing.T) {
	rule := &metadata.Rule{
		Type: "field",
		Definition: metadata.RuleDefinition{
			Field: "total", Operator: "min", Value: float64(0),
			Message: "Total must be non-negative",
		},
	}

	// Should fail: value below min
	detail := EvaluateFieldRule(rule, map[string]any{"total": float64(-5)})
	if detail == nil {
		t.Fatal("expected error for total=-5")
	}
	if detail.Field != "total" {
		t.Fatalf("expected field=total, got %s", detail.Field)
	}
	if detail.Rule != "min" {
		t.Fatalf("expected rule=min, got %s", detail.Rule)
	}

	// Should pass: value at min
	detail = EvaluateFieldRule(rule, map[string]any{"total": float64(0)})
	if detail != nil {
		t.Fatalf("expected pass for total=0, got %v", detail)
	}

	// Should pass: value above min
	detail = EvaluateFieldRule(rule, map[string]any{"total": float64(10)})
	if detail != nil {
		t.Fatalf("expected pass for total=10, got %v", detail)
	}

	// Should pass: field absent (not required check, just min)
	detail = EvaluateFieldRule(rule, map[string]any{})
	if detail != nil {
		t.Fatalf("expected pass for absent field, got %v", detail)
	}
}

func TestEvaluateFieldRule_Max(t *testing.T) {
	rule := &metadata.Rule{
		Type: "field",
		Definition: metadata.RuleDefinition{
			Field: "quantity", Operator: "max", Value: float64(100),
			Message: "Quantity cannot exceed 100",
		},
	}

	// Should fail
	detail := EvaluateFieldRule(rule, map[string]any{"quantity": float64(150)})
	if detail == nil {
		t.Fatal("expected error for quantity=150")
	}
	if detail.Rule != "max" {
		t.Fatalf("expected rule=max, got %s", detail.Rule)
	}

	// Should pass
	detail = EvaluateFieldRule(rule, map[string]any{"quantity": float64(50)})
	if detail != nil {
		t.Fatalf("expected pass for quantity=50, got %v", detail)
	}
}

func TestEvaluateFieldRule_MinLength(t *testing.T) {
	rule := &metadata.Rule{
		Type: "field",
		Definition: metadata.RuleDefinition{
			Field: "name", Operator: "min_length", Value: float64(3),
			Message: "Name must be at least 3 characters",
		},
	}

	// Should fail
	detail := EvaluateFieldRule(rule, map[string]any{"name": "AB"})
	if detail == nil {
		t.Fatal("expected error for name=AB")
	}
	if detail.Rule != "min_length" {
		t.Fatalf("expected rule=min_length, got %s", detail.Rule)
	}

	// Should pass
	detail = EvaluateFieldRule(rule, map[string]any{"name": "Alice"})
	if detail != nil {
		t.Fatalf("expected pass for name=Alice, got %v", detail)
	}
}

func TestEvaluateFieldRule_MaxLength(t *testing.T) {
	rule := &metadata.Rule{
		Type: "field",
		Definition: metadata.RuleDefinition{
			Field: "code", Operator: "max_length", Value: float64(5),
			Message: "Code must be at most 5 characters",
		},
	}

	// Should fail
	detail := EvaluateFieldRule(rule, map[string]any{"code": "TOOLONG"})
	if detail == nil {
		t.Fatal("expected error for code=TOOLONG")
	}

	// Should pass
	detail = EvaluateFieldRule(rule, map[string]any{"code": "ABC"})
	if detail != nil {
		t.Fatalf("expected pass for code=ABC, got %v", detail)
	}
}

func TestEvaluateFieldRule_Pattern(t *testing.T) {
	rule := &metadata.Rule{
		Type: "field",
		Definition: metadata.RuleDefinition{
			Field: "email", Operator: "pattern", Value: `^[^@]+@[^@]+\.[^@]+$`,
			Message: "Invalid email format",
		},
	}

	// Should fail
	detail := EvaluateFieldRule(rule, map[string]any{"email": "notanemail"})
	if detail == nil {
		t.Fatal("expected error for invalid email")
	}
	if detail.Rule != "pattern" {
		t.Fatalf("expected rule=pattern, got %s", detail.Rule)
	}

	// Should pass
	detail = EvaluateFieldRule(rule, map[string]any{"email": "user@example.com"})
	if detail != nil {
		t.Fatalf("expected pass for valid email, got %v", detail)
	}
}

// --- Expression Rule Tests ---

func TestCompileExpression(t *testing.T) {
	prog, err := CompileExpression("record.status == 'paid' && record.payment_date == nil")
	if err != nil {
		t.Fatalf("compile expression: %v", err)
	}
	if prog == nil {
		t.Fatal("expected non-nil program")
	}
}

func TestEvaluateExpressionRule_Violated(t *testing.T) {
	rule := &metadata.Rule{
		Type: "expression",
		Definition: metadata.RuleDefinition{
			Expression: "record.status == 'paid' && record.payment_date == nil",
			Message:    "Payment date is required when status is paid",
		},
	}
	// Pre-compile
	prog, err := CompileExpression(rule.Definition.Expression)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	rule.Compiled = prog

	env := map[string]any{
		"record": map[string]any{"status": "paid", "payment_date": nil},
		"old":    map[string]any{},
		"action": "create",
	}
	detail := EvaluateExpressionRule(rule, env)
	if detail == nil {
		t.Fatal("expected violation when status=paid and payment_date=nil")
	}
	if detail.Message != "Payment date is required when status is paid" {
		t.Fatalf("unexpected message: %s", detail.Message)
	}
}

func TestEvaluateExpressionRule_Passes(t *testing.T) {
	rule := &metadata.Rule{
		Type: "expression",
		Definition: metadata.RuleDefinition{
			Expression: "record.status == 'paid' && record.payment_date == nil",
			Message:    "Payment date is required when status is paid",
		},
	}
	prog, _ := CompileExpression(rule.Definition.Expression)
	rule.Compiled = prog

	env := map[string]any{
		"record": map[string]any{"status": "paid", "payment_date": "2025-01-01"},
		"old":    map[string]any{},
		"action": "create",
	}
	detail := EvaluateExpressionRule(rule, env)
	if detail != nil {
		t.Fatalf("expected pass when payment_date is set, got %v", detail)
	}
}

func TestEvaluateExpressionRule_WithOldRecord(t *testing.T) {
	rule := &metadata.Rule{
		Type: "expression",
		Definition: metadata.RuleDefinition{
			Expression: "action == 'update' && record.status == 'cancelled' && old.status == 'paid'",
			Message:    "Cannot cancel a paid order",
		},
	}
	prog, _ := CompileExpression(rule.Definition.Expression)
	rule.Compiled = prog

	// Should violate
	env := map[string]any{
		"record": map[string]any{"status": "cancelled"},
		"old":    map[string]any{"status": "paid"},
		"action": "update",
	}
	detail := EvaluateExpressionRule(rule, env)
	if detail == nil {
		t.Fatal("expected violation when cancelling a paid order")
	}

	// Should pass (not an update)
	env["action"] = "create"
	detail = EvaluateExpressionRule(rule, env)
	if detail != nil {
		t.Fatalf("expected pass on create, got %v", detail)
	}
}

// --- Computed Field Tests ---

func TestEvaluateComputedField(t *testing.T) {
	rule := &metadata.Rule{
		Type: "computed",
		Definition: metadata.RuleDefinition{
			Field:      "total",
			Expression: "record.subtotal * (1 + record.tax_rate)",
		},
	}
	prog, err := CompileComputedExpression(rule.Definition.Expression)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	rule.Compiled = prog

	env := map[string]any{
		"record": map[string]any{"subtotal": float64(100), "tax_rate": float64(0.1)},
		"old":    map[string]any{},
		"action": "create",
	}
	val, err := EvaluateComputedField(rule, env)
	if err != nil {
		t.Fatalf("evaluate computed: %v", err)
	}
	result, ok := val.(float64)
	if !ok {
		t.Fatalf("expected float64 result, got %T", val)
	}
	if result < 109.99 || result > 110.01 {
		t.Fatalf("expected ~110.0, got %f", result)
	}
}

func TestEvaluateComputedField_StringConcat(t *testing.T) {
	rule := &metadata.Rule{
		Type: "computed",
		Definition: metadata.RuleDefinition{
			Field:      "display_name",
			Expression: "record.first_name + ' ' + record.last_name",
		},
	}
	prog, err := CompileComputedExpression(rule.Definition.Expression)
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	rule.Compiled = prog

	env := map[string]any{
		"record": map[string]any{"first_name": "John", "last_name": "Doe"},
		"old":    map[string]any{},
		"action": "create",
	}
	val, err := EvaluateComputedField(rule, env)
	if err != nil {
		t.Fatalf("evaluate computed: %v", err)
	}
	if val != "John Doe" {
		t.Fatalf("expected 'John Doe', got %v", val)
	}
}

func TestEvaluateFieldRule_IntegerValues(t *testing.T) {
	rule := &metadata.Rule{
		Type: "field",
		Definition: metadata.RuleDefinition{
			Field: "age", Operator: "min", Value: float64(18),
			Message: "Must be at least 18",
		},
	}

	// Integer value in record (common from DB)
	detail := EvaluateFieldRule(rule, map[string]any{"age": 16})
	if detail == nil {
		t.Fatal("expected error for age=16 (int)")
	}

	detail = EvaluateFieldRule(rule, map[string]any{"age": 20})
	if detail != nil {
		t.Fatalf("expected pass for age=20 (int), got %v", detail)
	}
}
