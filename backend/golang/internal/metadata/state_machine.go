package metadata

import "encoding/json"

// TransitionAction represents an action to execute during a state transition.
type TransitionAction struct {
	Type   string `json:"type"`            // "set_field", "webhook", "create_record", "send_event"
	Field  string `json:"field,omitempty"` // for set_field
	Value  any    `json:"value,omitempty"` // for set_field ("now" = current timestamp)
	URL    string `json:"url,omitempty"`   // for webhook
	Method string `json:"method,omitempty"`
	Event  string `json:"event,omitempty"` // for send_event
	Entity string `json:"entity,omitempty"`
}

// TransitionFrom handles both string and []string for the "from" field.
type TransitionFrom []string

func (t *TransitionFrom) UnmarshalJSON(data []byte) error {
	// Try string first
	var single string
	if err := json.Unmarshal(data, &single); err == nil {
		*t = []string{single}
		return nil
	}
	// Try array
	var arr []string
	if err := json.Unmarshal(data, &arr); err != nil {
		return err
	}
	*t = arr
	return nil
}

func (t TransitionFrom) MarshalJSON() ([]byte, error) {
	if len(t) == 1 {
		return json.Marshal(t[0])
	}
	return json.Marshal([]string(t))
}

// Transition represents a single allowed state change.
type Transition struct {
	From    TransitionFrom   `json:"from"`
	To      string           `json:"to"`
	Roles   []string         `json:"roles,omitempty"`
	Guard   string           `json:"guard,omitempty"`
	Actions []TransitionAction `json:"actions,omitempty"`

	// CompiledGuard holds the compiled guard expression (not serialized).
	CompiledGuard any `json:"-"`
}

// StateMachineDefinition is the JSONB content of a state machine.
type StateMachineDefinition struct {
	Initial     string       `json:"initial"`
	Transitions []Transition `json:"transitions"`
}

// StateMachine represents a state machine configuration from the _state_machines table.
type StateMachine struct {
	ID         string                 `json:"id"`
	Entity     string                 `json:"entity"`
	Field      string                 `json:"field"` // the state field (e.g., "status")
	Definition StateMachineDefinition `json:"definition"`
	Active     bool                   `json:"active"`
}
