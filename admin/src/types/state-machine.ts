export const ACTION_TYPES = ["set_field", "webhook", "create_record", "send_event"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface TransitionAction {
  type: ActionType;
  field?: string;
  value?: string;
  url?: string;
  method?: string;
  event?: string;
  entity?: string;
}

export interface Transition {
  from: string | string[];
  to: string;
  roles?: string[];
  guard?: string;
  actions?: TransitionAction[];
}

export interface StateMachineDefinition {
  initial: string;
  transitions: Transition[];
}

export interface StateMachinePayload {
  id?: string;
  entity: string;
  field: string;
  definition: StateMachineDefinition;
  active: boolean;
}

/** Shape returned by GET /api/_admin/state-machines */
export interface StateMachineRow {
  id: string;
  entity: string;
  field: string;
  definition: string | StateMachineDefinition;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export function parseDefinition(row: StateMachineRow): StateMachineDefinition {
  if (typeof row.definition === "string") {
    return JSON.parse(row.definition);
  }
  return row.definition;
}

export function emptyStateMachine(): StateMachinePayload {
  return {
    entity: "",
    field: "status",
    definition: {
      initial: "",
      transitions: [{ from: "", to: "", actions: [] }],
    },
    active: true,
  };
}

export function emptyTransition(): Transition {
  return { from: "", to: "", actions: [] };
}

export function emptyAction(): TransitionAction {
  return { type: "set_field", field: "", value: "" };
}

/** Normalize the `from` field: always return an array of strings */
function normalizeFrom(from: string | string[]): string[] {
  if (typeof from === "string") return from ? [from] : [];
  return from;
}

/** Format the `from` field for display */
export function formatFrom(from: string | string[]): string {
  const arr = normalizeFrom(from);
  return arr.join(", ");
}
