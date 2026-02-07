import type { Registry } from "../metadata/registry.js";
import type { StateMachine, Transition } from "../metadata/state-machine.js";
import type { ErrorDetail } from "./errors.js";

/**
 * Evaluates all active state machines for the entity.
 * Returns validation errors if a transition is invalid or a guard fails.
 * Mutates fields with set_field actions on successful transitions.
 */
export function evaluateStateMachines(
  registry: Registry,
  entityName: string,
  fields: Record<string, any>,
  old: Record<string, any>,
  isCreate: boolean,
): ErrorDetail[] {
  const machines = registry.getStateMachinesForEntity(entityName);
  if (machines.length === 0) return [];

  const errs: ErrorDetail[] = [];
  for (const sm of machines) {
    errs.push(...evaluateStateMachine(sm, fields, old, isCreate));
  }
  return errs;
}

function evaluateStateMachine(
  sm: StateMachine,
  fields: Record<string, any>,
  old: Record<string, any>,
  isCreate: boolean,
): ErrorDetail[] {
  const newState = fields[sm.field];
  if (newState === undefined) return []; // state field not in payload

  const newStateStr = String(newState);

  if (isCreate) {
    if (sm.definition.initial && newStateStr !== sm.definition.initial) {
      return [{
        field: sm.field,
        rule: "state_machine",
        message: `Initial state must be '${sm.definition.initial}', got '${newStateStr}'`,
      }];
    }
    return [];
  }

  // Update: find matching transition
  const oldState = old[sm.field] != null ? String(old[sm.field]) : "";

  if (oldState === newStateStr) return []; // no state change

  const transition = findTransition(sm, oldState, newStateStr);
  if (!transition) {
    return [{
      field: sm.field,
      rule: "state_machine",
      message: `Invalid transition from '${oldState}' to '${newStateStr}'`,
    }];
  }

  // Evaluate guard
  if (transition.guard) {
    const env = { record: fields, old, action: "update" };
    const [blocked, err] = evaluateGuard(transition, env);
    if (err) {
      return [{
        field: sm.field,
        rule: "state_machine",
        message: `Guard evaluation error: ${err}`,
      }];
    }
    if (blocked) {
      return [{
        field: sm.field,
        rule: "state_machine",
        message: `Transition from '${oldState}' to '${newStateStr}' blocked by guard`,
      }];
    }
  }

  // Execute actions
  executeActions(transition, fields);

  return [];
}

/**
 * Finds a matching transition for the given old and new state.
 */
export function findTransition(
  sm: StateMachine,
  oldState: string,
  newState: string,
): Transition | undefined {
  for (const t of sm.definition.transitions) {
    if (t.to !== newState) continue;
    for (const from of t.from) {
      if (from === oldState) return t;
    }
  }
  return undefined;
}

/**
 * Compiles and runs a guard expression.
 * Returns [blocked, error]. blocked=true means transition is not allowed.
 * Guard semantics: expression returns true = allowed, false = blocked.
 */
export function evaluateGuard(
  transition: Transition,
  env: Record<string, any>,
): [boolean, string | null] {
  try {
    if (!transition.compiledGuard) {
      transition.compiledGuard = new Function(
        "env",
        `with (env) { return !!(${transition.guard}); }`,
      );
    }
    const allowed = transition.compiledGuard(env);
    return [!allowed, null]; // blocked = !allowed
  } catch (err: any) {
    return [false, err.message ?? String(err)];
  }
}

/**
 * Executes transition actions, mutating fields for set_field actions.
 */
export function executeActions(
  transition: Transition,
  fields: Record<string, any>,
): void {
  for (const action of transition.actions ?? []) {
    switch (action.type) {
      case "set_field": {
        let val = action.value;
        if (val === "now") {
          val = new Date().toISOString();
        }
        fields[action.field!] = val;
        break;
      }
      case "webhook":
        console.log(
          `STUB: webhook action ${action.method} ${action.url} (not yet implemented)`,
        );
        break;
      case "create_record":
        console.log(
          `STUB: create_record action for entity ${action.entity} (not yet implemented)`,
        );
        break;
      case "send_event":
        console.log(
          `STUB: send_event action '${action.event}' (not yet implemented)`,
        );
        break;
    }
  }
}
