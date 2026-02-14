import { Show, For, type JSX } from "solid-js";
import type {
  WorkflowPayload,
  WorkflowStep,
  WorkflowAction,
  WorkflowAssignee,
} from "../types/workflow";
import {
  STEP_TYPES,
  WORKFLOW_ACTION_TYPES,
  ASSIGNEE_TYPES,
  emptyStep,
  emptyWorkflowAction,
  emptyAssignee,
  gotoDisplay,
  gotoFromString,
} from "../types/workflow";
import { TextInput } from "../components/form/text-input";
import { SelectInput } from "../components/form/select-input";
import { Toggle } from "../components/form/toggle";

interface WorkflowEditorProps {
  wf: WorkflowPayload;
  entityNames: string[];
  onChange: (wf: WorkflowPayload) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}

export function WorkflowEditor(props: WorkflowEditorProps) {
  const update = (partial: Partial<WorkflowPayload>) => {
    props.onChange({ ...props.wf, ...partial });
  };

  const updateTrigger = (partial: Partial<WorkflowPayload["trigger"]>) => {
    props.onChange({
      ...props.wf,
      trigger: { ...props.wf.trigger, ...partial },
    });
  };

  // Context mappings helpers
  const contextEntries = () => Object.entries(props.wf.context);

  const updateContext = (entries: [string, string][]) => {
    const ctx: Record<string, string> = {};
    for (const [k, v] of entries) {
      if (k) ctx[k] = v;
    }
    update({ context: ctx });
  };

  const addContextMapping = () => {
    updateContext([...contextEntries(), ["", ""]]);
  };

  const removeContextMapping = (idx: number) => {
    const entries = contextEntries().filter((_, i) => i !== idx);
    updateContext(entries);
  };

  const updateContextEntry = (idx: number, key: string, val: string) => {
    const entries = [...contextEntries()];
    entries[idx] = [key, val];
    updateContext(entries);
  };

  // Steps helpers
  const updateStep = (idx: number, partial: Partial<WorkflowStep>) => {
    const steps = [...props.wf.steps];
    steps[idx] = { ...steps[idx], ...partial };
    update({ steps });
  };

  const addStep = () => {
    update({ steps: [...props.wf.steps, emptyStep()] });
  };

  const removeStep = (idx: number) => {
    update({ steps: props.wf.steps.filter((_, i) => i !== idx) });
  };

  // Actions within a step
  const updateAction = (sIdx: number, aIdx: number, partial: Partial<WorkflowAction>) => {
    const steps = [...props.wf.steps];
    const actions = [...(steps[sIdx].actions ?? [])];
    actions[aIdx] = { ...actions[aIdx], ...partial };
    steps[sIdx] = { ...steps[sIdx], actions };
    update({ steps });
  };

  const addAction = (sIdx: number) => {
    const steps = [...props.wf.steps];
    steps[sIdx] = {
      ...steps[sIdx],
      actions: [...(steps[sIdx].actions ?? []), emptyWorkflowAction()],
    };
    update({ steps });
  };

  const removeAction = (sIdx: number, aIdx: number) => {
    const steps = [...props.wf.steps];
    steps[sIdx] = {
      ...steps[sIdx],
      actions: (steps[sIdx].actions ?? []).filter((_, i) => i !== aIdx),
    };
    update({ steps });
  };

  const entityOptions = () =>
    props.entityNames.map((n) => ({ value: n, label: n }));

  // Step IDs for goto targets
  const stepIdOptions = () => [
    { value: "end", label: "end (finish)" },
    ...props.wf.steps
      .filter((s) => s.id)
      .map((s) => ({ value: s.id, label: s.id })),
  ];

  return (
    <div class="flex flex-col gap-4">
      <Show when={props.error}>
        <div class="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-md text-sm text-red-700 dark:text-red-300">
          {props.error}
        </div>
      </Show>

      {/* Basic Info */}
      <div class="form-row">
        <TextInput
          label="Workflow Name"
          value={props.wf.name}
          onInput={(v) => update({ name: v })}
          placeholder="e.g. purchase_approval"
        />
        <div style="display: flex; align-items: flex-end;">
          <Toggle
            label="Active"
            checked={props.wf.active}
            onChange={(v) => update({ active: v })}
          />
        </div>
      </div>

      {/* Trigger */}
      <div class="flex flex-col gap-2">
        <label class="form-label" style="margin-bottom: 0;">Trigger</label>
        <div class="p-3 border border-gray-200 dark:border-gray-700 rounded-md flex flex-col gap-2">
          <div class="form-row">
            <SelectInput
              label="Entity"
              value={props.wf.trigger.entity}
              onChange={(v) => updateTrigger({ entity: v })}
              options={entityOptions()}
              placeholder="Select entity"
            />
            <TextInput
              label="Field"
              value={props.wf.trigger.field ?? ""}
              onInput={(v) => updateTrigger({ field: v })}
              placeholder="e.g. status"
            />
            <TextInput
              label="To State"
              value={props.wf.trigger.to ?? ""}
              onInput={(v) => updateTrigger({ to: v })}
              placeholder="e.g. approved"
            />
          </div>
        </div>
      </div>

      {/* Context Mappings */}
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <label class="form-label" style="margin-bottom: 0;">Context Mappings</label>
          <button class="btn-secondary btn-sm" onClick={addContextMapping}>
            + Add Mapping
          </button>
        </div>
        <For each={contextEntries()}>
          {([key, val], idx) => (
            <div class="form-row" style="align-items: flex-end;">
              <TextInput
                label={idx() === 0 ? "Key" : ""}
                value={key}
                onInput={(v) => updateContextEntry(idx(), v, val)}
                placeholder="e.g. record_id"
              />
              <TextInput
                label={idx() === 0 ? "Path" : ""}
                value={val}
                onInput={(v) => updateContextEntry(idx(), key, v)}
                placeholder="e.g. trigger.record_id"
              />
              <button
                class="btn-danger btn-sm"
                style="margin-bottom: 2px;"
                onClick={() => removeContextMapping(idx())}
              >
                x
              </button>
            </div>
          )}
        </For>
      </div>

      {/* Steps */}
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <label class="form-label" style="margin-bottom: 0;">Steps</label>
          <button class="btn-secondary btn-sm" onClick={addStep}>
            + Add Step
          </button>
        </div>

        <For each={props.wf.steps}>
          {(step, sIdx) => (
            <div class="p-3 border border-gray-200 dark:border-gray-700 rounded-md flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class="text-xs text-gray-500 dark:text-gray-400 font-medium">Step {sIdx() + 1}</span>
                <button class="btn-danger btn-sm" onClick={() => removeStep(sIdx())}>
                  Remove
                </button>
              </div>

              <div class="form-row">
                <TextInput
                  label="Step ID"
                  value={step.id}
                  onInput={(v) => updateStep(sIdx(), { id: v })}
                  placeholder="e.g. check_amount"
                />
                <SelectInput
                  label="Type"
                  value={step.type}
                  onChange={(v) => updateStep(sIdx(), { type: v as any })}
                  options={STEP_TYPES.map((t) => ({ value: t, label: t }))}
                />
              </div>

              {/* Action Step Fields */}
              <Show when={step.type === "action"}>
                <div class="flex flex-col gap-2">
                  <div class="flex items-center justify-between">
                    <span class="text-xs text-gray-500 dark:text-gray-400">Actions</span>
                    <button class="btn-secondary btn-sm" onClick={() => addAction(sIdx())}>
                      + Action
                    </button>
                  </div>
                  <For each={step.actions ?? []}>
                    {(action, aIdx) => (
                      <div class="p-2 bg-gray-50 dark:bg-gray-800/50 rounded flex flex-col gap-1">
                        <div class="flex items-center gap-2">
                          <SelectInput
                            label=""
                            value={action.type}
                            onChange={(v) => updateAction(sIdx(), aIdx(), { type: v as any })}
                            options={WORKFLOW_ACTION_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))}
                          />
                          <button
                            class="btn-danger btn-sm"
                            style="margin-top: 0;"
                            onClick={() => removeAction(sIdx(), aIdx())}
                          >
                            x
                          </button>
                        </div>
                        <Show when={action.type === "set_field"}>
                          <div class="form-row">
                            <SelectInput
                              label="Entity"
                              value={action.entity ?? ""}
                              onChange={(v) => updateAction(sIdx(), aIdx(), { entity: v })}
                              options={entityOptions()}
                              placeholder="Select entity"
                            />
                            <TextInput
                              label="Record ID Path"
                              value={action.record_id ?? ""}
                              onInput={(v) => updateAction(sIdx(), aIdx(), { record_id: v })}
                              placeholder="e.g. context.record_id"
                            />
                          </div>
                          <div class="form-row">
                            <TextInput
                              label="Field"
                              value={action.field ?? ""}
                              onInput={(v) => updateAction(sIdx(), aIdx(), { field: v })}
                              placeholder="e.g. approved_at"
                            />
                            <TextInput
                              label="Value"
                              value={String(action.value ?? "")}
                              onInput={(v) => updateAction(sIdx(), aIdx(), { value: v })}
                              placeholder='e.g. now'
                            />
                          </div>
                        </Show>
                        <Show when={action.type === "webhook"}>
                          <div class="form-row">
                            <TextInput
                              label="URL"
                              value={action.url ?? ""}
                              onInput={(v) => updateAction(sIdx(), aIdx(), { url: v })}
                              placeholder="e.g. /hooks/notify"
                            />
                            <TextInput
                              label="Method"
                              value={action.method ?? "POST"}
                              onInput={(v) => updateAction(sIdx(), aIdx(), { method: v })}
                              placeholder="POST"
                            />
                          </div>
                        </Show>
                        <Show when={action.type === "send_event"}>
                          <TextInput
                            label="Event"
                            value={action.event ?? ""}
                            onInput={(v) => updateAction(sIdx(), aIdx(), { event: v })}
                            placeholder="e.g. order.approved"
                          />
                        </Show>
                        <Show when={action.type === "create_record"}>
                          <TextInput
                            label="Entity"
                            value={action.entity ?? ""}
                            onInput={(v) => updateAction(sIdx(), aIdx(), { entity: v })}
                            placeholder="e.g. audit_log"
                          />
                        </Show>
                      </div>
                    )}
                  </For>
                  <SelectInput
                    label="Then (goto)"
                    value={gotoDisplay(step.then)}
                    onChange={(v) => updateStep(sIdx(), { then: gotoFromString(v) })}
                    options={stepIdOptions()}
                    placeholder="Select next step or end"
                  />
                </div>
              </Show>

              {/* Condition Step Fields */}
              <Show when={step.type === "condition"}>
                <TextInput
                  label="Expression"
                  value={step.expression ?? ""}
                  onInput={(v) => updateStep(sIdx(), { expression: v })}
                  placeholder="e.g. context.amount < 1000"
                />
                <div class="form-row">
                  <SelectInput
                    label="On True (goto)"
                    value={gotoDisplay(step.on_true)}
                    onChange={(v) => updateStep(sIdx(), { on_true: gotoFromString(v) })}
                    options={stepIdOptions()}
                    placeholder="Select step"
                  />
                  <SelectInput
                    label="On False (goto)"
                    value={gotoDisplay(step.on_false)}
                    onChange={(v) => updateStep(sIdx(), { on_false: gotoFromString(v) })}
                    options={stepIdOptions()}
                    placeholder="Select step"
                  />
                </div>
              </Show>

              {/* Approval Step Fields */}
              <Show when={step.type === "approval"}>
                <div class="form-row">
                  <SelectInput
                    label="Assignee Type"
                    value={step.assignee?.type ?? "role"}
                    onChange={(v) =>
                      updateStep(sIdx(), {
                        assignee: { ...(step.assignee ?? emptyAssignee()), type: v as any },
                      })
                    }
                    options={ASSIGNEE_TYPES.map((t) => ({ value: t, label: t }))}
                  />
                  <Show when={step.assignee?.type === "role"}>
                    <TextInput
                      label="Role"
                      value={step.assignee?.role ?? ""}
                      onInput={(v) =>
                        updateStep(sIdx(), {
                          assignee: { ...(step.assignee ?? emptyAssignee()), role: v },
                        })
                      }
                      placeholder="e.g. manager"
                    />
                  </Show>
                  <Show when={step.assignee?.type === "fixed"}>
                    <TextInput
                      label="User"
                      value={step.assignee?.user ?? ""}
                      onInput={(v) =>
                        updateStep(sIdx(), {
                          assignee: { ...(step.assignee ?? emptyAssignee()), user: v },
                        })
                      }
                      placeholder="e.g. admin@example.com"
                    />
                  </Show>
                  <Show when={step.assignee?.type === "relation"}>
                    <TextInput
                      label="Path"
                      value={step.assignee?.path ?? ""}
                      onInput={(v) =>
                        updateStep(sIdx(), {
                          assignee: { ...(step.assignee ?? emptyAssignee()), path: v },
                        })
                      }
                      placeholder="e.g. context.manager_id"
                    />
                  </Show>
                </div>
                <TextInput
                  label="Timeout"
                  value={step.timeout ?? ""}
                  onInput={(v) => updateStep(sIdx(), { timeout: v })}
                  placeholder="e.g. 72h"
                />
                <div class="form-row">
                  <SelectInput
                    label="On Approve (goto)"
                    value={gotoDisplay(step.on_approve)}
                    onChange={(v) => updateStep(sIdx(), { on_approve: gotoFromString(v) })}
                    options={stepIdOptions()}
                    placeholder="Select step"
                  />
                  <SelectInput
                    label="On Reject (goto)"
                    value={gotoDisplay(step.on_reject)}
                    onChange={(v) => updateStep(sIdx(), { on_reject: gotoFromString(v) })}
                    options={stepIdOptions()}
                    placeholder="Select step"
                  />
                  <SelectInput
                    label="On Timeout (goto)"
                    value={gotoDisplay(step.on_timeout)}
                    onChange={(v) => updateStep(sIdx(), { on_timeout: gotoFromString(v) })}
                    options={stepIdOptions()}
                    placeholder="Select step"
                  />
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>

      <div class="modal-footer" style="padding: 0; border: none; margin-top: 0.5rem;">
        <button class="btn-secondary" onClick={props.onCancel}>
          Cancel
        </button>
        <button class="btn-primary" onClick={props.onSave} disabled={props.saving}>
          {props.saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
