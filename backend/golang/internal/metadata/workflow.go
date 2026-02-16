package metadata

import (
	"encoding/json"

	"github.com/expr-lang/expr/vm"
)

// StepGoto handles both {"goto":"step_id"} and "end" in JSON.
type StepGoto struct {
	Goto string
}

func (s *StepGoto) UnmarshalJSON(data []byte) error {
	// Try string first ("end")
	var str string
	if err := json.Unmarshal(data, &str); err == nil {
		s.Goto = str
		return nil
	}
	// Try object {"goto": "step_id"}
	var obj struct {
		Goto string `json:"goto"`
	}
	if err := json.Unmarshal(data, &obj); err != nil {
		return err
	}
	s.Goto = obj.Goto
	return nil
}

func (s StepGoto) MarshalJSON() ([]byte, error) {
	if s.Goto == "end" {
		return json.Marshal("end")
	}
	return json.Marshal(struct {
		Goto string `json:"goto"`
	}{Goto: s.Goto})
}

// WorkflowTrigger defines when a workflow starts.
type WorkflowTrigger struct {
	Type   string `json:"type"`            // "state_change"
	Entity string `json:"entity"`
	Field  string `json:"field,omitempty"`
	To     string `json:"to,omitempty"`
}

// WorkflowAssignee defines who is assigned to an approval step.
type WorkflowAssignee struct {
	Type string `json:"type"`            // "relation", "role", "fixed"
	Path string `json:"path,omitempty"`  // for type=relation
	Role string `json:"role,omitempty"`  // for type=role
	User string `json:"user,omitempty"`  // for type=fixed
}

// WorkflowAction defines an action to execute within a workflow step.
type WorkflowAction struct {
	Type     string `json:"type"`                // "set_field", "webhook", "send_event", "create_record"
	Entity   string `json:"entity,omitempty"`
	RecordID string `json:"record_id,omitempty"` // context path expression e.g. "context.record_id"
	Field    string `json:"field,omitempty"`
	Value    any    `json:"value,omitempty"`
	URL      string `json:"url,omitempty"`
	Method   string `json:"method,omitempty"`
	Event    string `json:"event,omitempty"`
}

// WorkflowStep represents a single step in the workflow.
type WorkflowStep struct {
	ID string `json:"id"`
	// Type is "action", "condition", or "approval".
	Type string `json:"type"`

	// Action step fields
	Actions []WorkflowAction `json:"actions,omitempty"`
	Then    *StepGoto        `json:"then,omitempty"`

	// Condition step fields
	Expression          string      `json:"expression,omitempty"`
	CompiledExpression  *vm.Program `json:"-"`
	OnTrue              *StepGoto   `json:"on_true,omitempty"`
	OnFalse             *StepGoto   `json:"on_false,omitempty"`

	// Approval step fields
	Assignee  *WorkflowAssignee `json:"assignee,omitempty"`
	Timeout   string            `json:"timeout,omitempty"` // e.g. "72h", "48h"
	OnApprove *StepGoto         `json:"on_approve,omitempty"`
	OnReject  *StepGoto         `json:"on_reject,omitempty"`
	OnTimeout *StepGoto         `json:"on_timeout,omitempty"`
}

// Workflow represents a workflow definition from the _workflows table.
type Workflow struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Trigger WorkflowTrigger   `json:"trigger"`
	Context map[string]string `json:"context"`
	Steps   []WorkflowStep    `json:"steps"`
	Active  bool              `json:"active"`
}

// WorkflowHistoryEntry records what happened at each step.
type WorkflowHistoryEntry struct {
	Step   string `json:"step"`
	Status string `json:"status"` // "completed", "approved", "rejected", "timed_out"
	By     string `json:"by,omitempty"`
	At     string `json:"at"`
}

// WorkflowInstance represents a running or completed workflow instance.
type WorkflowInstance struct {
	ID                  string                 `json:"id"`
	WorkflowID          string                 `json:"workflow_id"`
	WorkflowName        string                 `json:"workflow_name"`
	Status              string                 `json:"status"` // "running", "completed", "failed", "cancelled"
	CurrentStep         string                 `json:"current_step"`
	CurrentStepDeadline *string                `json:"current_step_deadline,omitempty"`
	Context             map[string]any         `json:"context"`
	History             []WorkflowHistoryEntry `json:"history"`
	CreatedAt           string                 `json:"created_at,omitempty"`
	UpdatedAt           string                 `json:"updated_at,omitempty"`
}

// FindStep returns the step with the given ID, or nil if not found.
func (w *Workflow) FindStep(id string) *WorkflowStep {
	for i := range w.Steps {
		if w.Steps[i].ID == id {
			return &w.Steps[i]
		}
	}
	return nil
}
