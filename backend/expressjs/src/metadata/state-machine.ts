export interface TransitionAction {
  type: string; // "set_field", "webhook", "create_record", "send_event"
  field?: string;
  value?: any; // "now" = current timestamp
  url?: string;
  method?: string;
  event?: string;
  entity?: string;
}

export interface Transition {
  from: string[]; // normalized: always an array (JSON accepts string or string[])
  to: string;
  roles?: string[];
  guard?: string;
  actions?: TransitionAction[];

  // Compiled guard (set at evaluation time, not serialized)
  compiledGuard?: any;
}

export interface StateMachineDefinition {
  initial: string;
  transitions: Transition[];
}

export interface StateMachine {
  id: string;
  entity: string;
  field: string;
  definition: StateMachineDefinition;
  active: boolean;
}

/**
 * Normalizes the `from` field of each transition.
 * JSON allows `"from": "draft"` or `"from": ["draft", "sent"]`.
 * This ensures `from` is always a string array.
 */
export function normalizeDefinition(def: StateMachineDefinition): StateMachineDefinition {
  return {
    ...def,
    transitions: (def.transitions ?? []).map((t) => ({
      ...t,
      from: typeof t.from === "string" ? [t.from] : (t.from ?? []),
      actions: t.actions ?? [],
    })),
  };
}
