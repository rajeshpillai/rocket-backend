package metadata

type Relation struct {
	Name          string `json:"name"`
	Type          string `json:"type"` // one_to_one, one_to_many, many_to_many
	Source        string `json:"source"`
	Target        string `json:"target"`
	SourceKey     string `json:"source_key"`
	TargetKey     string `json:"target_key,omitempty"`
	JoinTable     string `json:"join_table,omitempty"`
	SourceJoinKey string `json:"source_join_key,omitempty"`
	TargetJoinKey string `json:"target_join_key,omitempty"`
	Ownership     string `json:"ownership"`  // source, target, none
	OnDelete      string `json:"on_delete"`  // cascade, set_null, restrict, detach
	Fetch         string `json:"fetch,omitempty"`      // lazy (default), eager
	WriteMode     string `json:"write_mode,omitempty"` // diff (default), replace, append
}

func (r *Relation) IsManyToMany() bool {
	return r.Type == "many_to_many"
}

func (r *Relation) IsOneToMany() bool {
	return r.Type == "one_to_many"
}

func (r *Relation) IsOneToOne() bool {
	return r.Type == "one_to_one"
}

// DefaultWriteMode returns the write mode, defaulting to "diff".
func (r *Relation) DefaultWriteMode() string {
	if r.WriteMode != "" {
		return r.WriteMode
	}
	return "diff"
}

// DefaultFetch returns the fetch strategy, defaulting to "lazy".
func (r *Relation) DefaultFetch() string {
	if r.Fetch != "" {
		return r.Fetch
	}
	return "lazy"
}
