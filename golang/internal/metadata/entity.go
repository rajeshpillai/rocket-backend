package metadata

type SlugConfig struct {
	Field              string `json:"field"`                         // slug field name (must exist in fields, must be unique)
	Source             string `json:"source,omitempty"`              // auto-generate from this field
	RegenerateOnUpdate bool   `json:"regenerate_on_update,omitempty"` // re-generate slug on update when source changes
}

type Entity struct {
	Name       string      `json:"name"`
	Table      string      `json:"table"`
	PrimaryKey PrimaryKey  `json:"primary_key"`
	SoftDelete bool        `json:"soft_delete"`
	Slug       *SlugConfig `json:"slug,omitempty"`
	Fields     []Field     `json:"fields"`
}

type PrimaryKey struct {
	Field     string `json:"field"`
	Type      string `json:"type"`      // uuid, int, bigint, string
	Generated bool   `json:"generated"`
}

// GetField returns a pointer to the field with the given name, or nil.
func (e *Entity) GetField(name string) *Field {
	for i := range e.Fields {
		if e.Fields[i].Name == name {
			return &e.Fields[i]
		}
	}
	return nil
}

// HasField returns true if the entity has a field with the given name.
func (e *Entity) HasField(name string) bool {
	return e.GetField(name) != nil
}

// FieldNames returns all field names.
func (e *Entity) FieldNames() []string {
	names := make([]string, len(e.Fields))
	for i, f := range e.Fields {
		names[i] = f.Name
	}
	return names
}

// WritableFields returns fields that can be set by the client.
// Excludes auto-generated PKs and auto-timestamp fields.
func (e *Entity) WritableFields() []Field {
	var fields []Field
	for _, f := range e.Fields {
		if f.Name == e.PrimaryKey.Field && e.PrimaryKey.Generated {
			continue
		}
		if f.IsAuto() {
			continue
		}
		fields = append(fields, f)
	}
	return fields
}

// UpdatableFields returns fields that can be set on UPDATE.
// Excludes PK, auto="create" fields. Includes auto="update" handled by engine.
func (e *Entity) UpdatableFields() []Field {
	var fields []Field
	for _, f := range e.Fields {
		if f.Name == e.PrimaryKey.Field {
			continue
		}
		if f.IsAuto() {
			continue
		}
		if f.Name == "deleted_at" {
			continue
		}
		fields = append(fields, f)
	}
	return fields
}
