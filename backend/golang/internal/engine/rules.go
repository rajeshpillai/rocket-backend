package engine

import (
	"context"
	"fmt"
	"regexp"

	"github.com/expr-lang/expr"
	"github.com/expr-lang/expr/vm"

	"rocket-backend/internal/instrument"
	"rocket-backend/internal/metadata"
)

// EvaluateRules runs all active rules for an entity/hook against the record.
// It returns validation errors for field and expression rules, and mutates
// the fields map for computed rules.
func EvaluateRules(ctx context.Context, reg *metadata.Registry, entityName string, hook string, fields map[string]any, old map[string]any, isCreate bool) []ErrorDetail {
	_, span := instrument.GetInstrumenter(ctx).StartSpan(ctx, "engine", "rules", "rules.evaluate")
	defer span.End()
	span.SetEntity(entityName, "")

	rules := reg.GetRulesForEntity(entityName, hook)
	if len(rules) == 0 {
		span.SetStatus("ok")
		return nil
	}

	action := "update"
	if isCreate {
		action = "create"
	}

	env := map[string]any{
		"record": fields,
		"old":    old,
		"action": action,
	}

	var errs []ErrorDetail

	// 1. Field rules
	for _, r := range rules {
		if r.Type != "field" {
			continue
		}
		if detail := EvaluateFieldRule(r, fields); detail != nil {
			errs = append(errs, *detail)
			if r.Definition.StopOnFail {
				span.SetStatus("error")
				return errs
			}
		}
	}

	// 2. Expression rules
	for _, r := range rules {
		if r.Type != "expression" {
			continue
		}
		if detail := EvaluateExpressionRule(r, env); detail != nil {
			errs = append(errs, *detail)
			if r.Definition.StopOnFail {
				span.SetStatus("error")
				return errs
			}
		}
	}

	// If there are validation errors, don't run computed fields
	if len(errs) > 0 {
		span.SetStatus("error")
		return errs
	}

	// 3. Computed fields
	for _, r := range rules {
		if r.Type != "computed" {
			continue
		}
		val, err := EvaluateComputedField(r, env)
		if err != nil {
			errs = append(errs, ErrorDetail{
				Field:   r.Definition.Field,
				Rule:    "computed",
				Message: err.Error(),
			})
			continue
		}
		fields[r.Definition.Field] = val
	}

	if len(errs) > 0 {
		span.SetStatus("error")
	} else {
		span.SetStatus("ok")
	}
	return errs
}

// EvaluateFieldRule evaluates a single field rule against a record.
// Returns nil if the rule passes, or an ErrorDetail if it fails.
func EvaluateFieldRule(rule *metadata.Rule, record map[string]any) *ErrorDetail {
	fieldName := rule.Definition.Field
	val, exists := record[fieldName]
	if !exists || val == nil {
		return nil // absent fields are not checked by field rules (use "required" for that)
	}

	op := rule.Definition.Operator
	msg := rule.Definition.Message
	if msg == "" {
		msg = fmt.Sprintf("field %s failed %s validation", fieldName, op)
	}

	switch op {
	case "min":
		num, ok := toFloat64(val)
		if !ok {
			return nil
		}
		threshold, ok := toFloat64(rule.Definition.Value)
		if !ok {
			return nil
		}
		if num < threshold {
			return &ErrorDetail{Field: fieldName, Rule: "min", Message: msg}
		}

	case "max":
		num, ok := toFloat64(val)
		if !ok {
			return nil
		}
		threshold, ok := toFloat64(rule.Definition.Value)
		if !ok {
			return nil
		}
		if num > threshold {
			return &ErrorDetail{Field: fieldName, Rule: "max", Message: msg}
		}

	case "min_length":
		s, ok := val.(string)
		if !ok {
			return nil
		}
		threshold, ok := toFloat64(rule.Definition.Value)
		if !ok {
			return nil
		}
		if len(s) < int(threshold) {
			return &ErrorDetail{Field: fieldName, Rule: "min_length", Message: msg}
		}

	case "max_length":
		s, ok := val.(string)
		if !ok {
			return nil
		}
		threshold, ok := toFloat64(rule.Definition.Value)
		if !ok {
			return nil
		}
		if len(s) > int(threshold) {
			return &ErrorDetail{Field: fieldName, Rule: "max_length", Message: msg}
		}

	case "pattern":
		s, ok := val.(string)
		if !ok {
			return nil
		}
		pattern, ok := rule.Definition.Value.(string)
		if !ok {
			return nil
		}
		matched, err := regexp.MatchString(pattern, s)
		if err != nil || !matched {
			return &ErrorDetail{Field: fieldName, Rule: "pattern", Message: msg}
		}
	}

	return nil
}

// CompileExpression compiles an expression string into an expr-lang program.
func CompileExpression(expression string) (*vm.Program, error) {
	prog, err := expr.Compile(expression, expr.AsBool())
	if err != nil {
		return nil, fmt.Errorf("compile expression: %w", err)
	}
	return prog, nil
}

// EvaluateExpressionRule evaluates a compiled expression rule against an environment.
// The env should contain: record, old, action (and optionally related data).
// Returns nil if the rule passes (expression is false), or an ErrorDetail if violated (expression is true).
func EvaluateExpressionRule(rule *metadata.Rule, env map[string]any) *ErrorDetail {
	prog, ok := rule.Compiled.(*vm.Program)
	if !ok || prog == nil {
		// Lazy compile
		compiled, err := CompileExpression(rule.Definition.Expression)
		if err != nil {
			return &ErrorDetail{Rule: "expression", Message: fmt.Sprintf("compile error: %v", err)}
		}
		rule.Compiled = compiled
		prog = compiled
	}

	result, err := expr.Run(prog, env)
	if err != nil {
		return &ErrorDetail{Rule: "expression", Message: fmt.Sprintf("rule evaluation error: %v", err)}
	}

	violated, ok := result.(bool)
	if !ok {
		return nil
	}

	if violated {
		msg := rule.Definition.Message
		if msg == "" {
			msg = "Expression rule violated"
		}
		return &ErrorDetail{Rule: "expression", Message: msg}
	}

	return nil
}

// CompileComputedExpression compiles an expression for a computed field (returns any value, not bool).
func CompileComputedExpression(expression string) (*vm.Program, error) {
	prog, err := expr.Compile(expression)
	if err != nil {
		return nil, fmt.Errorf("compile computed expression: %w", err)
	}
	return prog, nil
}

// EvaluateComputedField evaluates a computed field rule and returns the computed value.
func EvaluateComputedField(rule *metadata.Rule, env map[string]any) (any, error) {
	prog, ok := rule.Compiled.(*vm.Program)
	if !ok || prog == nil {
		// Lazy compile
		compiled, err := CompileComputedExpression(rule.Definition.Expression)
		if err != nil {
			return nil, fmt.Errorf("compile computed expression: %w", err)
		}
		rule.Compiled = compiled
		prog = compiled
	}

	result, err := expr.Run(prog, env)
	if err != nil {
		return nil, fmt.Errorf("evaluate computed field %s: %w", rule.Definition.Field, err)
	}

	return result, nil
}

// toFloat64 converts numeric types to float64.
func toFloat64(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case int32:
		return float64(n), true
	}
	return 0, false
}
