package metadata

// RelatedLoadSpec tells the engine which relation to pre-fetch before evaluating an expression.
type RelatedLoadSpec struct {
	Relation string         `json:"relation"`
	Filter   map[string]any `json:"filter,omitempty"`
}

// RuleDefinition is the JSONB content of a rule.
type RuleDefinition struct {
	// Field rules
	Field    string `json:"field,omitempty"`
	Operator string `json:"operator,omitempty"`
	Value    any    `json:"value,omitempty"`

	// Expression / computed rules
	Expression string `json:"expression,omitempty"`

	// Shared
	Message    string `json:"message,omitempty"`
	StopOnFail bool   `json:"stop_on_fail,omitempty"`

	// Related data loading
	RelatedLoad []RelatedLoadSpec `json:"related_load,omitempty"`
}

// Rule represents a validation or computed rule from the _rules table.
type Rule struct {
	ID         string         `json:"id"`
	Entity     string         `json:"entity"`
	Hook       string         `json:"hook"`
	Type       string         `json:"type"` // "field", "expression", "computed"
	Definition RuleDefinition `json:"definition"`
	Priority   int            `json:"priority"`
	Active     bool           `json:"active"`

	// Compiled holds the compiled expression program (set at load time, not serialized).
	Compiled any `json:"-"`
}
