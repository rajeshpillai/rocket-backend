import { Show, For, type JSX } from "solid-js";
import type {
  StateMachinePayload,
  Transition,
  TransitionAction,
} from "../types/state-machine";
import {
  ACTION_TYPES,
  emptyTransition,
  emptyAction,
} from "../types/state-machine";
import { TextInput } from "../components/form/TextInput";
import { SelectInput } from "../components/form/SelectInput";
import { Toggle } from "../components/form/Toggle";

interface StateMachineEditorProps {
  sm: StateMachinePayload;
  entityNames: string[];
  onChange: (sm: StateMachinePayload) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}

export function StateMachineEditor(props: StateMachineEditorProps) {
  const update = (partial: Partial<StateMachinePayload>) => {
    props.onChange({ ...props.sm, ...partial });
  };

  const updateDef = (partial: Partial<StateMachinePayload["definition"]>) => {
    props.onChange({
      ...props.sm,
      definition: { ...props.sm.definition, ...partial },
    });
  };

  const updateTransition = (idx: number, partial: Partial<Transition>) => {
    const transitions = [...props.sm.definition.transitions];
    transitions[idx] = { ...transitions[idx], ...partial };
    updateDef({ transitions });
  };

  const addTransition = () => {
    updateDef({
      transitions: [...props.sm.definition.transitions, emptyTransition()],
    });
  };

  const removeTransition = (idx: number) => {
    const transitions = props.sm.definition.transitions.filter(
      (_, i) => i !== idx,
    );
    updateDef({ transitions });
  };

  const updateAction = (
    tIdx: number,
    aIdx: number,
    partial: Partial<TransitionAction>,
  ) => {
    const transitions = [...props.sm.definition.transitions];
    const actions = [...(transitions[tIdx].actions ?? [])];
    actions[aIdx] = { ...actions[aIdx], ...partial };
    transitions[tIdx] = { ...transitions[tIdx], actions };
    updateDef({ transitions });
  };

  const addAction = (tIdx: number) => {
    const transitions = [...props.sm.definition.transitions];
    transitions[tIdx] = {
      ...transitions[tIdx],
      actions: [...(transitions[tIdx].actions ?? []), emptyAction()],
    };
    updateDef({ transitions });
  };

  const removeAction = (tIdx: number, aIdx: number) => {
    const transitions = [...props.sm.definition.transitions];
    const actions = (transitions[tIdx].actions ?? []).filter(
      (_, i) => i !== aIdx,
    );
    transitions[tIdx] = { ...transitions[tIdx], actions };
    updateDef({ transitions });
  };

  const entityOptions = () =>
    props.entityNames.map((n) => ({ value: n, label: n }));

  return (
    <div class="flex flex-col gap-4">
      <Show when={props.error}>
        <div class="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {props.error}
        </div>
      </Show>

      <div class="form-row">
        <SelectInput
          label="Entity"
          value={props.sm.entity}
          onChange={(v) => update({ entity: v })}
          options={entityOptions()}
          placeholder="Select entity"
        />
        <TextInput
          label="State Field"
          value={props.sm.field}
          onInput={(v) => update({ field: v })}
          placeholder="e.g. status"
        />
      </div>

      <div class="form-row">
        <TextInput
          label="Initial State"
          value={props.sm.definition.initial}
          onInput={(v) => updateDef({ initial: v })}
          placeholder="e.g. draft"
        />
        <div style="display: flex; align-items: flex-end;">
          <Toggle
            label="Active"
            checked={props.sm.active}
            onChange={(v) => update({ active: v })}
          />
        </div>
      </div>

      {/* Transitions */}
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <label class="form-label" style="margin-bottom: 0;">
            Transitions
          </label>
          <button class="btn-secondary btn-sm" onClick={addTransition}>
            + Add Transition
          </button>
        </div>

        <For each={props.sm.definition.transitions}>
          {(transition, tIdx) => (
            <div class="p-3 border border-gray-200 rounded-md flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class="text-xs text-gray-500 font-medium">
                  Transition {tIdx() + 1}
                </span>
                <button
                  class="btn-danger btn-sm"
                  onClick={() => removeTransition(tIdx())}
                >
                  Remove
                </button>
              </div>

              <div class="form-row">
                <TextInput
                  label="From State(s)"
                  value={
                    Array.isArray(transition.from)
                      ? transition.from.join(", ")
                      : transition.from
                  }
                  onInput={(v) =>
                    updateTransition(tIdx(), {
                      from: v.includes(",")
                        ? v.split(",").map((s) => s.trim()).filter(Boolean)
                        : v,
                    })
                  }
                  placeholder="e.g. draft  or  draft, sent"
                />
                <TextInput
                  label="To State"
                  value={transition.to}
                  onInput={(v) => updateTransition(tIdx(), { to: v })}
                  placeholder="e.g. sent"
                />
              </div>

              <TextInput
                label="Guard Expression"
                value={transition.guard ?? ""}
                onInput={(v) =>
                  updateTransition(tIdx(), { guard: v || undefined })
                }
                placeholder="e.g. record.total > 0"
              />

              <TextInput
                label="Roles (comma-separated)"
                value={(transition.roles ?? []).join(", ")}
                onInput={(v) =>
                  updateTransition(tIdx(), {
                    roles: v
                      ? v.split(",").map((s) => s.trim()).filter(Boolean)
                      : undefined,
                  })
                }
                placeholder="e.g. admin, accountant"
              />

              {/* Actions */}
              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-gray-500">Actions</span>
                  <button
                    class="btn-secondary btn-sm"
                    onClick={() => addAction(tIdx())}
                  >
                    + Action
                  </button>
                </div>

                <For each={transition.actions ?? []}>
                  {(action, aIdx) => (
                    <div class="p-2 bg-gray-50 rounded flex flex-col gap-1">
                      <div class="flex items-center gap-2">
                        <SelectInput
                          label=""
                          value={action.type}
                          onChange={(v) =>
                            updateAction(tIdx(), aIdx(), {
                              type: v as any,
                            })
                          }
                          options={ACTION_TYPES.map((t) => ({
                            value: t,
                            label: t.replace(/_/g, " "),
                          }))}
                        />
                        <button
                          class="btn-danger btn-sm"
                          style="margin-top: 0;"
                          onClick={() => removeAction(tIdx(), aIdx())}
                        >
                          x
                        </button>
                      </div>

                      <Show when={action.type === "set_field"}>
                        <div class="form-row">
                          <TextInput
                            label="Field"
                            value={action.field ?? ""}
                            onInput={(v) =>
                              updateAction(tIdx(), aIdx(), { field: v })
                            }
                            placeholder="e.g. sent_at"
                          />
                          <TextInput
                            label="Value"
                            value={String(action.value ?? "")}
                            onInput={(v) =>
                              updateAction(tIdx(), aIdx(), { value: v })
                            }
                            placeholder='e.g. now'
                          />
                        </div>
                      </Show>

                      <Show when={action.type === "webhook"}>
                        <div class="form-row">
                          <TextInput
                            label="URL"
                            value={action.url ?? ""}
                            onInput={(v) =>
                              updateAction(tIdx(), aIdx(), { url: v })
                            }
                            placeholder="e.g. /hooks/invoice-paid"
                          />
                          <TextInput
                            label="Method"
                            value={action.method ?? "POST"}
                            onInput={(v) =>
                              updateAction(tIdx(), aIdx(), { method: v })
                            }
                            placeholder="POST"
                          />
                        </div>
                      </Show>

                      <Show when={action.type === "create_record"}>
                        <TextInput
                          label="Entity"
                          value={action.entity ?? ""}
                          onInput={(v) =>
                            updateAction(tIdx(), aIdx(), { entity: v })
                          }
                          placeholder="e.g. audit_log"
                        />
                      </Show>

                      <Show when={action.type === "send_event"}>
                        <TextInput
                          label="Event Name"
                          value={action.event ?? ""}
                          onInput={(v) =>
                            updateAction(tIdx(), aIdx(), { event: v })
                          }
                          placeholder="e.g. invoice.paid"
                        />
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>

      <div
        class="modal-footer"
        style="padding: 0; border: none; margin-top: 0.5rem;"
      >
        <button class="btn-secondary" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          class="btn-primary"
          onClick={props.onSave}
          disabled={props.saving}
        >
          {props.saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
