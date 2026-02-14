import { Show, For } from "solid-js";
import type { Transition, TransitionAction, ActionType } from "../../types/state-machine";
import { ACTION_TYPES, emptyTransition, emptyAction, formatFrom } from "../../types/state-machine";

interface EditableStatePanelProps {
  stateName: string;
  isInitial: boolean;
  allStates: string[];
  transitions: Transition[];         // all transitions in the SM
  onRenameState: (oldName: string, newName: string) => void;
  onSetInitial: (name: string) => void;
  onDeleteState: (name: string) => void;
  onUpdateTransition: (idx: number, partial: Partial<Transition>) => void;
  onAddTransition: (from: string) => void;
  onDeleteTransition: (idx: number) => void;
  onClose: () => void;
}

function TransitionCard(props: {
  transition: Transition;
  index: number;
  allStates: string[];
  onUpdate: (partial: Partial<Transition>) => void;
  onDelete: () => void;
}) {
  const updateAction = (aIdx: number, partial: Partial<TransitionAction>) => {
    const actions = [...(props.transition.actions ?? [])];
    actions[aIdx] = { ...actions[aIdx], ...partial };
    props.onUpdate({ actions });
  };

  const removeAction = (aIdx: number) => {
    const actions = (props.transition.actions ?? []).filter((_, i) => i !== aIdx);
    props.onUpdate({ actions });
  };

  const addAction = () => {
    const actions = [...(props.transition.actions ?? []), emptyAction()];
    props.onUpdate({ actions });
  };

  return (
    <div class="transition-card">
      <div class="transition-card-header">
        <span>{formatFrom(props.transition.from)} &rarr; {props.transition.to || "?"}</span>
        <button class="action-remove-btn" onClick={props.onDelete}>remove</button>
      </div>

      <div class="diagram-property-section">
        <span class="diagram-property-label">To</span>
        <select
          class="metadata-select text-xs"
          value={props.transition.to}
          onChange={(e) => props.onUpdate({ to: e.currentTarget.value })}
        >
          <option value="">-- select --</option>
          <For each={props.allStates}>
            {(s) => <option value={s}>{s}</option>}
          </For>
        </select>
      </div>

      <div class="diagram-property-section">
        <span class="diagram-property-label">Guard</span>
        <input
          class="metadata-input text-xs font-mono"
          value={props.transition.guard ?? ""}
          onInput={(e) => props.onUpdate({ guard: e.currentTarget.value || undefined })}
          placeholder="record.total > 0"
        />
      </div>

      <div class="diagram-property-section">
        <span class="diagram-property-label">Roles (comma-separated)</span>
        <input
          class="metadata-input text-xs"
          value={(props.transition.roles ?? []).join(", ")}
          onInput={(e) => {
            const val = e.currentTarget.value;
            const roles = val ? val.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
            props.onUpdate({ roles });
          }}
          placeholder="admin, accountant"
        />
      </div>

      <div class="diagram-property-section">
        <div class="flex items-center justify-between">
          <span class="diagram-property-label">Actions</span>
          <button class="panel-add-btn" onClick={addAction}>+ Add</button>
        </div>
        <For each={props.transition.actions ?? []}>
          {(action, aIdx) => (
            <div class="action-card">
              <div class="action-card-header">
                <select
                  class="metadata-select text-xs"
                  value={action.type}
                  onChange={(e) => updateAction(aIdx(), { type: e.currentTarget.value as ActionType })}
                >
                  <For each={[...ACTION_TYPES]}>
                    {(t) => <option value={t}>{t}</option>}
                  </For>
                </select>
                <button class="action-remove-btn" onClick={() => removeAction(aIdx())}>remove</button>
              </div>
              <Show when={action.type === "set_field"}>
                <input class="metadata-input text-xs" placeholder="Field" value={action.field ?? ""}
                  onInput={(e) => updateAction(aIdx(), { field: e.currentTarget.value })} />
                <input class="metadata-input text-xs" placeholder="Value" value={action.value ?? ""}
                  onInput={(e) => updateAction(aIdx(), { value: e.currentTarget.value })} />
              </Show>
              <Show when={action.type === "webhook"}>
                <input class="metadata-input text-xs" placeholder="URL" value={action.url ?? ""}
                  onInput={(e) => updateAction(aIdx(), { url: e.currentTarget.value })} />
                <input class="metadata-input text-xs" placeholder="Method" value={action.method ?? ""}
                  onInput={(e) => updateAction(aIdx(), { method: e.currentTarget.value })} />
              </Show>
              <Show when={action.type === "create_record"}>
                <input class="metadata-input text-xs" placeholder="Entity" value={action.entity ?? ""}
                  onInput={(e) => updateAction(aIdx(), { entity: e.currentTarget.value })} />
              </Show>
              <Show when={action.type === "send_event"}>
                <input class="metadata-input text-xs" placeholder="Event" value={action.event ?? ""}
                  onInput={(e) => updateAction(aIdx(), { event: e.currentTarget.value })} />
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

export function EditableStatePanel(props: EditableStatePanelProps) {
  // Find transitions originating from this state
  const transitionsFrom = () =>
    props.transitions
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => {
        const froms = Array.isArray(t.from) ? t.from : t.from ? [t.from] : [];
        return froms.includes(props.stateName);
      });

  return (
    <div class="diagram-property-panel">
      <div class="diagram-property-header">
        <span class="diagram-property-title">{props.stateName}</span>
        <button class="diagram-property-close" onClick={props.onClose}>
          &times;
        </button>
      </div>

      {/* State Name */}
      <div class="diagram-property-section">
        <span class="diagram-property-label">State Name</span>
        <input
          class="metadata-input text-xs"
          value={props.stateName}
          onChange={(e) => {
            const newName = e.currentTarget.value.trim();
            if (newName && newName !== props.stateName) {
              props.onRenameState(props.stateName, newName);
            }
          }}
        />
      </div>

      {/* Initial state toggle */}
      <div class="diagram-property-section">
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={props.isInitial}
            onChange={() => props.onSetInitial(props.stateName)}
          />
          <span class="text-xs text-gray-600">Initial state</span>
        </label>
      </div>

      {/* Transitions from this state */}
      <div class="diagram-property-section">
        <div class="flex items-center justify-between">
          <span class="diagram-property-label">
            Transitions ({transitionsFrom().length})
          </span>
          <button class="panel-add-btn" onClick={() => props.onAddTransition(props.stateName)}>
            + Add
          </button>
        </div>
        <div class="flex flex-col gap-2">
          <For each={transitionsFrom()}>
            {({ t, i }) => (
              <TransitionCard
                transition={t}
                index={i}
                allStates={props.allStates}
                onUpdate={(p) => props.onUpdateTransition(i, p)}
                onDelete={() => props.onDeleteTransition(i)}
              />
            )}
          </For>
        </div>
      </div>

      <button class="panel-delete-btn" onClick={() => props.onDeleteState(props.stateName)}>
        Delete State
      </button>
    </div>
  );
}
