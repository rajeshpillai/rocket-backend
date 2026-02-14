import { Show, For } from "solid-js";
import type {
  WorkflowStep,
  WorkflowAction,
  StepType,
  WorkflowActionType,
  AssigneeType,
} from "../../types/workflow";
import {
  STEP_TYPES,
  WORKFLOW_ACTION_TYPES,
  ASSIGNEE_TYPES,
  gotoDisplay,
  gotoFromString,
  emptyWorkflowAction,
  emptyAssignee,
} from "../../types/workflow";

interface EditableStepPanelProps {
  step: WorkflowStep;
  allStepIds: string[];
  onUpdate: (partial: Partial<WorkflowStep>) => void;
  onDelete: () => void;
  onClose: () => void;
}

function GotoSelect(props: {
  label: string;
  value: string | undefined;
  stepIds: string[];
  onChange: (val: string) => void;
}) {
  return (
    <div class="diagram-property-section">
      <span class="diagram-property-label">{props.label}</span>
      <select
        class="metadata-select text-xs"
        value={props.value ?? ""}
        onChange={(e) => props.onChange(e.currentTarget.value)}
      >
        <option value="">(next step)</option>
        <option value="end">End workflow</option>
        <For each={props.stepIds}>
          {(id) => <option value={id}>{id}</option>}
        </For>
      </select>
    </div>
  );
}

function ActionCard(props: {
  action: WorkflowAction;
  index: number;
  onUpdate: (partial: Partial<WorkflowAction>) => void;
  onRemove: () => void;
}) {
  return (
    <div class="action-card">
      <div class="action-card-header">
        <select
          class="metadata-select text-xs"
          value={props.action.type}
          onChange={(e) => props.onUpdate({ type: e.currentTarget.value as WorkflowActionType })}
        >
          <For each={[...WORKFLOW_ACTION_TYPES]}>
            {(t) => <option value={t}>{t}</option>}
          </For>
        </select>
        <button class="action-remove-btn" onClick={props.onRemove}>remove</button>
      </div>

      <Show when={props.action.type === "set_field"}>
        <input
          class="metadata-input text-xs"
          placeholder="Entity"
          value={props.action.entity ?? ""}
          onInput={(e) => props.onUpdate({ entity: e.currentTarget.value })}
        />
        <input
          class="metadata-input text-xs"
          placeholder="Field"
          value={props.action.field ?? ""}
          onInput={(e) => props.onUpdate({ field: e.currentTarget.value })}
        />
        <input
          class="metadata-input text-xs"
          placeholder="Value"
          value={String(props.action.value ?? "")}
          onInput={(e) => props.onUpdate({ value: e.currentTarget.value })}
        />
      </Show>

      <Show when={props.action.type === "webhook"}>
        <input
          class="metadata-input text-xs"
          placeholder="URL"
          value={props.action.url ?? ""}
          onInput={(e) => props.onUpdate({ url: e.currentTarget.value })}
        />
        <input
          class="metadata-input text-xs"
          placeholder="Method (POST)"
          value={props.action.method ?? ""}
          onInput={(e) => props.onUpdate({ method: e.currentTarget.value })}
        />
      </Show>

      <Show when={props.action.type === "create_record"}>
        <input
          class="metadata-input text-xs"
          placeholder="Entity"
          value={props.action.entity ?? ""}
          onInput={(e) => props.onUpdate({ entity: e.currentTarget.value })}
        />
      </Show>

      <Show when={props.action.type === "send_event"}>
        <input
          class="metadata-input text-xs"
          placeholder="Event name"
          value={props.action.event ?? ""}
          onInput={(e) => props.onUpdate({ event: e.currentTarget.value })}
        />
      </Show>
    </div>
  );
}

export function EditableStepPanel(props: EditableStepPanelProps) {
  const otherStepIds = () => props.allStepIds.filter((id) => id !== props.step.id && id);

  const updateAction = (idx: number, partial: Partial<WorkflowAction>) => {
    const actions = [...(props.step.actions ?? [])];
    actions[idx] = { ...actions[idx], ...partial };
    props.onUpdate({ actions });
  };

  const removeAction = (idx: number) => {
    const actions = (props.step.actions ?? []).filter((_, i) => i !== idx);
    props.onUpdate({ actions });
  };

  const addAction = () => {
    const actions = [...(props.step.actions ?? []), emptyWorkflowAction()];
    props.onUpdate({ actions });
  };

  const handleGotoChange = (field: string, val: string) => {
    props.onUpdate({ [field]: gotoFromString(val) });
  };

  return (
    <div class="diagram-property-panel">
      <div class="diagram-property-header">
        <span class="diagram-property-title">{props.step.id || "(unnamed step)"}</span>
        <button class="diagram-property-close" onClick={props.onClose}>
          &times;
        </button>
      </div>

      {/* Step ID */}
      <div class="diagram-property-section">
        <span class="diagram-property-label">Step ID</span>
        <input
          class="metadata-input text-xs"
          value={props.step.id}
          onInput={(e) => props.onUpdate({ id: e.currentTarget.value })}
          placeholder="unique_step_id"
        />
      </div>

      {/* Step Type */}
      <div class="diagram-property-section">
        <span class="diagram-property-label">Type</span>
        <select
          class="metadata-select text-xs"
          value={props.step.type}
          onChange={(e) => props.onUpdate({ type: e.currentTarget.value as StepType })}
        >
          <For each={[...STEP_TYPES]}>
            {(t) => <option value={t}>{t}</option>}
          </For>
        </select>
      </div>

      {/* === Action step === */}
      <Show when={props.step.type === "action"}>
        <div class="diagram-property-section">
          <div class="flex items-center justify-between">
            <span class="diagram-property-label">
              Actions ({(props.step.actions ?? []).length})
            </span>
            <button class="panel-add-btn" onClick={addAction}>+ Add</button>
          </div>
          <div class="flex flex-col gap-1.5">
            <For each={props.step.actions ?? []}>
              {(action, idx) => (
                <ActionCard
                  action={action}
                  index={idx()}
                  onUpdate={(p) => updateAction(idx(), p)}
                  onRemove={() => removeAction(idx())}
                />
              )}
            </For>
          </div>
        </div>
        <GotoSelect
          label="Then"
          value={gotoDisplay(props.step.then) || undefined}
          stepIds={otherStepIds()}
          onChange={(v) => handleGotoChange("then", v)}
        />
      </Show>

      {/* === Condition step === */}
      <Show when={props.step.type === "condition"}>
        <div class="diagram-property-section">
          <span class="diagram-property-label">Expression</span>
          <input
            class="metadata-input text-xs font-mono"
            value={props.step.expression ?? ""}
            onInput={(e) => props.onUpdate({ expression: e.currentTarget.value })}
            placeholder="record.field > 0"
          />
        </div>
        <GotoSelect
          label="On True"
          value={gotoDisplay(props.step.on_true) || undefined}
          stepIds={otherStepIds()}
          onChange={(v) => handleGotoChange("on_true", v)}
        />
        <GotoSelect
          label="On False"
          value={gotoDisplay(props.step.on_false) || undefined}
          stepIds={otherStepIds()}
          onChange={(v) => handleGotoChange("on_false", v)}
        />
      </Show>

      {/* === Approval step === */}
      <Show when={props.step.type === "approval"}>
        <div class="diagram-property-section">
          <span class="diagram-property-label">Assignee Type</span>
          <select
            class="metadata-select text-xs"
            value={props.step.assignee?.type ?? "role"}
            onChange={(e) => {
              const assignee = { ...(props.step.assignee ?? emptyAssignee()), type: e.currentTarget.value as AssigneeType };
              props.onUpdate({ assignee });
            }}
          >
            <For each={[...ASSIGNEE_TYPES]}>
              {(t) => <option value={t}>{t}</option>}
            </For>
          </select>
        </div>

        <Show when={props.step.assignee?.type === "role"}>
          <div class="diagram-property-section">
            <span class="diagram-property-label">Role</span>
            <input
              class="metadata-input text-xs"
              value={props.step.assignee?.role ?? ""}
              onInput={(e) => {
                const assignee = { ...(props.step.assignee ?? emptyAssignee()), role: e.currentTarget.value };
                props.onUpdate({ assignee });
              }}
              placeholder="manager"
            />
          </div>
        </Show>

        <Show when={props.step.assignee?.type === "fixed"}>
          <div class="diagram-property-section">
            <span class="diagram-property-label">User</span>
            <input
              class="metadata-input text-xs"
              value={props.step.assignee?.user ?? ""}
              onInput={(e) => {
                const assignee = { ...(props.step.assignee ?? emptyAssignee()), type: "fixed" as AssigneeType, user: e.currentTarget.value };
                props.onUpdate({ assignee });
              }}
              placeholder="admin@example.com"
            />
          </div>
        </Show>

        <Show when={props.step.assignee?.type === "relation"}>
          <div class="diagram-property-section">
            <span class="diagram-property-label">Path</span>
            <input
              class="metadata-input text-xs"
              value={props.step.assignee?.path ?? ""}
              onInput={(e) => {
                const assignee = { ...(props.step.assignee ?? emptyAssignee()), type: "relation" as AssigneeType, path: e.currentTarget.value };
                props.onUpdate({ assignee });
              }}
              placeholder="context.manager_id"
            />
          </div>
        </Show>

        <div class="diagram-property-section">
          <span class="diagram-property-label">Timeout</span>
          <input
            class="metadata-input text-xs"
            value={props.step.timeout ?? ""}
            onInput={(e) => props.onUpdate({ timeout: e.currentTarget.value })}
            placeholder="72h"
          />
        </div>

        <GotoSelect
          label="On Approve"
          value={gotoDisplay(props.step.on_approve) || undefined}
          stepIds={otherStepIds()}
          onChange={(v) => handleGotoChange("on_approve", v)}
        />
        <GotoSelect
          label="On Reject"
          value={gotoDisplay(props.step.on_reject) || undefined}
          stepIds={otherStepIds()}
          onChange={(v) => handleGotoChange("on_reject", v)}
        />
        <GotoSelect
          label="On Timeout"
          value={gotoDisplay(props.step.on_timeout) || undefined}
          stepIds={otherStepIds()}
          onChange={(v) => handleGotoChange("on_timeout", v)}
        />
      </Show>

      <button class="panel-delete-btn" onClick={props.onDelete}>
        Delete Step
      </button>
    </div>
  );
}
