// StepGoto handles both {"goto":"step_id"} and "end" in JSON.
// In TypeScript, we represent this as a simple object with a goto field.
// The JSON parsing handles both forms.
export interface StepGoto {
  goto: string;
}

/**
 * Parse a step goto value from JSON.
 * Accepts either "end" (string) or {"goto":"step_id"} (object).
 */
export function parseStepGoto(val: any): StepGoto | undefined {
  if (val == null) return undefined;
  if (typeof val === "string") return { goto: val };
  if (typeof val === "object" && val.goto) return { goto: val.goto };
  return undefined;
}

/**
 * Serialize a step goto value for JSON storage.
 * "end" is stored as the string "end", everything else as {"goto":"step_id"}.
 */
export function serializeStepGoto(sg: StepGoto | undefined): any {
  if (!sg) return undefined;
  if (sg.goto === "end") return "end";
  return { goto: sg.goto };
}

export interface WorkflowTrigger {
  type: string; // "state_change"
  entity: string;
  field?: string;
  to?: string;
}

export interface WorkflowAssignee {
  type: string; // "relation", "role", "fixed"
  path?: string;
  role?: string;
  user?: string;
}

export interface WorkflowAction {
  type: string; // "set_field", "webhook", "send_event", "create_record"
  entity?: string;
  record_id?: string; // context path expression e.g. "context.record_id"
  field?: string;
  value?: any;
  url?: string;
  method?: string;
  event?: string;
}

export interface WorkflowStep {
  id: string;
  type: string; // "action", "condition", "approval"

  // Action step fields
  actions?: WorkflowAction[];
  then?: StepGoto;

  // Condition step fields
  expression?: string;
  /** Cached compiled condition function (lazy-initialized). */
  compiledExpression?: (env: Record<string, any>) => boolean;
  on_true?: StepGoto;
  on_false?: StepGoto;

  // Approval step fields
  assignee?: WorkflowAssignee;
  timeout?: string; // e.g. "72h", "48h"
  on_approve?: StepGoto;
  on_reject?: StepGoto;
  on_timeout?: StepGoto;
}

export interface Workflow {
  id: string;
  name: string;
  trigger: WorkflowTrigger;
  context: Record<string, string>;
  steps: WorkflowStep[];
  active: boolean;
}

export interface WorkflowHistoryEntry {
  step: string;
  status: string; // "completed", "approved", "rejected", "timed_out"
  by?: string;
  at: string;
}

export interface WorkflowInstance {
  id: string;
  workflow_id: string;
  workflow_name: string;
  status: string; // "running", "completed", "failed", "cancelled"
  current_step: string;
  current_step_deadline?: string | null;
  context: Record<string, any>;
  history: WorkflowHistoryEntry[];
  created_at?: string;
  updated_at?: string;
}

/**
 * Find a step by ID in a workflow.
 */
export function findStep(wf: Workflow, id: string): WorkflowStep | undefined {
  return wf.steps.find((s) => s.id === id);
}

/**
 * Normalize step goto values in a workflow's steps.
 * Parses both "end" string and {"goto":"step_id"} object forms.
 */
export function normalizeWorkflowSteps(steps: any[]): WorkflowStep[] {
  return (steps ?? []).map((step) => ({
    ...step,
    then: parseStepGoto(step.then),
    on_true: parseStepGoto(step.on_true),
    on_false: parseStepGoto(step.on_false),
    on_approve: parseStepGoto(step.on_approve),
    on_reject: parseStepGoto(step.on_reject),
    on_timeout: parseStepGoto(step.on_timeout),
  }));
}
