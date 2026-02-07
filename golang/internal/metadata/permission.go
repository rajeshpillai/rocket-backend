package metadata

// Permission represents a metadata-driven permission policy.
type Permission struct {
	ID         string              `json:"id,omitempty"`
	Entity     string              `json:"entity"`
	Action     string              `json:"action"`
	Roles      []string            `json:"roles"`
	Conditions []PermissionCondition `json:"conditions,omitempty"`
}

// PermissionCondition is a field-level condition for a permission policy.
type PermissionCondition struct {
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    any    `json:"value"`
}
