package engine

import (
	"fmt"

	"github.com/expr-lang/expr"
	"github.com/expr-lang/expr/vm"
)

// ExpressionEvaluator abstracts condition evaluation for workflow steps.
type ExpressionEvaluator interface {
	EvaluateBool(expression string, env map[string]any) (bool, error)
}

// ExprLangEvaluator uses expr-lang/expr for safe expression evaluation.
// Compiled programs are cached by expression string.
type ExprLangEvaluator struct {
	cache map[string]*vm.Program
}

func NewExprLangEvaluator() *ExprLangEvaluator {
	return &ExprLangEvaluator{
		cache: make(map[string]*vm.Program),
	}
}

func (e *ExprLangEvaluator) EvaluateBool(expression string, env map[string]any) (bool, error) {
	prog, ok := e.cache[expression]
	if !ok {
		var err error
		prog, err = expr.Compile(expression, expr.AsBool())
		if err != nil {
			return false, fmt.Errorf("compile condition: %w", err)
		}
		e.cache[expression] = prog
	}

	result, err := expr.Run(prog, env)
	if err != nil {
		return false, fmt.Errorf("evaluate condition: %w", err)
	}

	isTrue, ok := result.(bool)
	if !ok {
		return false, fmt.Errorf("condition did not return bool")
	}

	return isTrue, nil
}
