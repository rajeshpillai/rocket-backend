package metadata

import "fmt"

type Field struct {
	Name      string   `json:"name"`
	Type      string   `json:"type"`
	Required  bool     `json:"required,omitempty"`
	Unique    bool     `json:"unique,omitempty"`
	Default   any      `json:"default,omitempty"`
	Nullable  bool     `json:"nullable,omitempty"`
	Enum      []string `json:"enum,omitempty"`
	Precision int      `json:"precision,omitempty"`
	Auto      string   `json:"auto,omitempty"` // "create" or "update"
}

// PostgresType returns the Postgres DDL type for this field.
func (f Field) PostgresType() string {
	switch f.Type {
	case "string", "text":
		return "TEXT"
	case "int":
		return "INTEGER"
	case "bigint":
		return "BIGINT"
	case "decimal":
		if f.Precision > 0 {
			return fmt.Sprintf("NUMERIC(18,%d)", f.Precision)
		}
		return "NUMERIC"
	case "boolean":
		return "BOOLEAN"
	case "uuid":
		return "UUID"
	case "timestamp":
		return "TIMESTAMPTZ"
	case "date":
		return "DATE"
	case "json", "file":
		return "JSONB"
	default:
		return "TEXT"
	}
}

// IsAuto returns true if the field is auto-managed by the engine.
func (f Field) IsAuto() bool {
	return f.Auto == "create" || f.Auto == "update"
}
