export const STEP_TYPES = ["action", "condition", "approval"] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const WORKFLOW_ACTION_TYPES = ["set_field", "webhook", "create_record", "send_event"] as const;
export type WorkflowActionType = (typeof WORKFLOW_ACTION_TYPES)[number];

export const ASSIGNEE_TYPES = ["relation", "role", "fixed"] as const;
export type AssigneeType = (typeof ASSIGNEE_TYPES)[number];

export interface StepGoto {
  goto: string;
}

export interface WorkflowTrigger {
  type: string;
  entity: string;
  field?: string;
  to?: string;
}

export interface WorkflowAssignee {
  type: AssigneeType;
  path?: string;
  role?: string;
  user?: string;
}

export interface WorkflowAction {
  type: WorkflowActionType;
  entity?: string;
  record_id?: string;
  field?: string;
  value?: any;
  url?: string;
  method?: string;
  event?: string;
}

export interface WorkflowStep {
  id: string;
  type: StepType;

  // Action step
  actions?: WorkflowAction[];
  then?: StepGoto | string;

  // Condition step
  expression?: string;
  on_true?: StepGoto | string;
  on_false?: StepGoto | string;

  // Approval step
  assignee?: WorkflowAssignee;
  timeout?: string;
  on_approve?: StepGoto | string;
  on_reject?: StepGoto | string;
  on_timeout?: StepGoto | string;
}

export interface WorkflowPayload {
  id?: string;
  name: string;
  trigger: WorkflowTrigger;
  context: Record<string, string>;
  steps: WorkflowStep[];
  active: boolean;
}

/** Shape returned by GET /api/_admin/workflows */
export interface WorkflowRow {
  id: string;
  name: string;
  trigger: string | WorkflowTrigger;
  context: string | Record<string, string>;
  steps: string | WorkflowStep[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkflowHistoryEntry {
  step: string;
  status: string;
  by?: string;
  at: string;
}

export interface WorkflowInstance {
  id: string;
  workflow_id: string;
  workflow_name: string;
  status: string;
  current_step: string;
  current_step_deadline?: string | null;
  context: Record<string, any>;
  history: WorkflowHistoryEntry[];
  created_at?: string;
  updated_at?: string;
}

export function parseWorkflowRow(row: WorkflowRow): WorkflowPayload {
  const trigger: WorkflowTrigger =
    typeof row.trigger === "string" ? JSON.parse(row.trigger) : row.trigger;
  const context: Record<string, string> =
    typeof row.context === "string" ? JSON.parse(row.context) : (row.context ?? {});
  const steps: WorkflowStep[] =
    typeof row.steps === "string" ? JSON.parse(row.steps) : (row.steps ?? []);
  return {
    id: row.id,
    name: row.name,
    trigger,
    context,
    steps,
    active: row.active,
  };
}

export function emptyWorkflow(): WorkflowPayload {
  return {
    name: "",
    trigger: { type: "state_change", entity: "", field: "", to: "" },
    context: {},
    steps: [emptyStep()],
    active: true,
  };
}

export function emptyStep(): WorkflowStep {
  return { id: "", type: "action", actions: [] };
}

export function emptyWorkflowAction(): WorkflowAction {
  return { type: "set_field", entity: "", record_id: "", field: "", value: "" };
}

export function emptyAssignee(): WorkflowAssignee {
  return { type: "role", role: "" };
}

/** Resolve a step goto value to a display string */
export function gotoDisplay(val: StepGoto | string | undefined): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  return val.goto ?? "";
}

/** Build a step goto from a string input */
export function gotoFromString(val: string): StepGoto | string | undefined {
  if (!val) return undefined;
  if (val === "end") return "end";
  return { goto: val };
}
