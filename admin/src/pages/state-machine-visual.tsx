import { createSignal, createMemo, Show, For, onMount, onCleanup } from "solid-js";
import type {
  StateMachinePayload,
  Transition,
} from "../types/state-machine";
import { emptyTransition } from "../types/state-machine";
import { layoutStateMachine } from "../components/diagram/graph-layout";
import { GraphCanvas } from "../components/diagram/graph-canvas";
import { EditableStatePanel } from "../components/diagram/editable-state-panel";
import { createStateMachine, updateStateMachine } from "../api/state-machines";
import { isApiError } from "../types/api";
import { addToast } from "../stores/notifications";

interface StateMachineVisualProps {
  sm: StateMachinePayload;
  onClose: () => void;
  editingId?: string | null;
  entityNames?: string[];
  onSaved?: () => void;
}

export function StateMachineVisual(props: StateMachineVisualProps) {
  const [draft, setDraft] = createSignal<StateMachinePayload>(
    JSON.parse(JSON.stringify(props.sm)),
  );
  const [selectedState, setSelectedState] = createSignal<string | null>(null);
  const [settingsOpen, setSettingsOpen] = createSignal(!props.editingId);
  const [addMenuOpen, setAddMenuOpen] = createSignal(false);
  const [newStateName, setNewStateName] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Collect all unique state names (from transitions + initial + extra)
  const [extraStates, setExtraStates] = createSignal<string[]>([]);

  const allStates = createMemo(() => {
    const def = draft().definition;
    const set = new Set<string>();
    if (def.initial) set.add(def.initial);
    for (const t of def.transitions) {
      const froms = Array.isArray(t.from) ? t.from : t.from ? [t.from] : [];
      for (const f of froms) if (f) set.add(f);
      if (t.to) set.add(t.to);
    }
    for (const s of extraStates()) if (s) set.add(s);
    return [...set].sort();
  });

  const layout = createMemo(() => layoutStateMachine(draft(), extraStates()));

  // --- Mutations ---
  const updateDraft = (partial: Partial<StateMachinePayload>) => {
    setDraft((d) => ({ ...d, ...partial }));
  };

  const renameState = (oldName: string, newName: string) => {
    setDraft((d) => {
      const def = { ...d.definition };
      if (def.initial === oldName) def.initial = newName;
      def.transitions = def.transitions.map((t) => ({
        ...t,
        from: renameFrom(t.from, oldName, newName),
        to: t.to === oldName ? newName : t.to,
      }));
      return { ...d, definition: def };
    });
    // Update extra states
    setExtraStates((es) =>
      es.map((s) => (s === oldName ? newName : s)),
    );
    // Update selection
    if (selectedState() === oldName) setSelectedState(newName);
  };

  const setInitialState = (name: string) => {
    setDraft((d) => ({
      ...d,
      definition: { ...d.definition, initial: name },
    }));
  };

  const addState = (name: string) => {
    if (!name.trim()) return;
    const trimmed = name.trim();
    if (allStates().includes(trimmed)) return;
    setExtraStates((es) => [...es, trimmed]);
    setSelectedState(trimmed);
    setAddMenuOpen(false);
    setNewStateName("");
  };

  const deleteState = (name: string) => {
    setDraft((d) => {
      const def = { ...d.definition };
      if (def.initial === name) def.initial = "";
      def.transitions = def.transitions.filter((t) => {
        const froms = Array.isArray(t.from) ? t.from : t.from ? [t.from] : [];
        // Remove transitions where this state is involved
        if (t.to === name) return false;
        if (froms.includes(name) && froms.length === 1) return false;
        return true;
      }).map((t) => {
        // Remove from multi-from arrays
        const froms = Array.isArray(t.from) ? t.from : t.from ? [t.from] : [];
        if (froms.includes(name)) {
          const filtered = froms.filter((f) => f !== name);
          return { ...t, from: filtered.length === 1 ? filtered[0] : filtered };
        }
        return t;
      });
      return { ...d, definition: def };
    });
    setExtraStates((es) => es.filter((s) => s !== name));
    setSelectedState(null);
  };

  const updateTransition = (idx: number, partial: Partial<Transition>) => {
    setDraft((d) => {
      const def = { ...d.definition };
      def.transitions = def.transitions.map((t, i) =>
        i === idx ? { ...t, ...partial } : t,
      );
      return { ...d, definition: def };
    });
  };

  const addTransition = (from: string) => {
    const t = emptyTransition();
    t.from = from;
    setDraft((d) => ({
      ...d,
      definition: {
        ...d.definition,
        transitions: [...d.definition.transitions, t],
      },
    }));
  };

  const deleteTransition = (idx: number) => {
    setDraft((d) => ({
      ...d,
      definition: {
        ...d.definition,
        transitions: d.definition.transitions.filter((_, i) => i !== idx),
      },
    }));
  };

  // --- Save ---
  const handleSave = async () => {
    const sm = draft();
    if (!sm.entity) {
      setError("Entity is required");
      setSettingsOpen(true);
      return;
    }
    if (!sm.field) {
      setError("State field is required");
      setSettingsOpen(true);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (props.editingId) {
        await updateStateMachine(props.editingId, sm);
        addToast("success", "State machine updated");
      } else {
        await createStateMachine(sm);
        addToast("success", "State machine created");
      }
      props.onSaved?.();
    } catch (err) {
      if (isApiError(err)) {
        setError(err.error.message);
      } else {
        setError("Failed to save state machine");
      }
    } finally {
      setSaving(false);
    }
  };

  // --- Keyboard ---
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (addMenuOpen()) { setAddMenuOpen(false); return; }
      props.onClose();
    }
  };
  onMount(() => document.addEventListener("keydown", handleKeyDown));
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown));

  const entityOptions = () => (props.entityNames ?? []);

  return (
    <div class="paper-view">
      {/* Header */}
      <div class="paper-header">
        <div class="paper-header-left">
          <button class="paper-back-btn" onClick={props.onClose}>
            &larr; Back
          </button>
          <h1 class="paper-title">
            {draft().entity || "New State Machine"}
            {draft().field ? ` / ${draft().field}` : ""}
            <span class="paper-subtitle">Visual Editor</span>
          </h1>
        </div>
        <div class="paper-header-right">
          <button
            class="btn-secondary btn-sm"
            onClick={() => setSettingsOpen((v) => !v)}
          >
            Settings
          </button>

          {/* Add State */}
          <div class="toolbar-dropdown">
            <button
              class="btn-secondary btn-sm"
              onClick={() => setAddMenuOpen((v) => !v)}
            >
              + Add State
            </button>
            <Show when={addMenuOpen()}>
              <div class="toolbar-dropdown-menu" style="min-width: 200px; padding: 8px;">
                <input
                  class="metadata-input text-xs w-full"
                  value={newStateName()}
                  onInput={(e) => setNewStateName(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addState(newStateName());
                  }}
                  placeholder="State name"
                  autofocus
                />
                <button
                  class="btn-primary btn-sm w-full mt-1"
                  onClick={() => addState(newStateName())}
                  disabled={!newStateName().trim()}
                >
                  Add
                </button>
              </div>
            </Show>
          </div>

          <button class="btn-secondary btn-sm" onClick={props.onClose}>
            Discard
          </button>
          <button
            class="btn-primary btn-sm"
            onClick={handleSave}
            disabled={saving()}
          >
            {saving() ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Error banner */}
      <Show when={error()}>
        <div class="px-6 py-2 bg-red-50 text-red-700 text-sm border-b border-red-200">
          {error()}
        </div>
      </Show>

      {/* Metadata panel (collapsible) */}
      <Show when={settingsOpen()}>
        <div class="metadata-panel">
          <div class="metadata-panel-inner">
            <div class="metadata-field">
              <label class="metadata-label">Entity</label>
              <Show
                when={entityOptions().length > 0}
                fallback={
                  <input
                    class="metadata-input"
                    value={draft().entity}
                    onInput={(e) => updateDraft({ entity: e.currentTarget.value })}
                    placeholder="entity_name"
                  />
                }
              >
                <select
                  class="metadata-select"
                  value={draft().entity}
                  onChange={(e) => updateDraft({ entity: e.currentTarget.value })}
                >
                  <option value="">-- select --</option>
                  <For each={entityOptions()}>
                    {(name) => <option value={name}>{name}</option>}
                  </For>
                </select>
              </Show>
            </div>
            <div class="metadata-field">
              <label class="metadata-label">State Field</label>
              <input
                class="metadata-input"
                value={draft().field}
                onInput={(e) => updateDraft({ field: e.currentTarget.value })}
                placeholder="status"
              />
            </div>
            <div class="metadata-field">
              <label class="metadata-label">Initial State</label>
              <input
                class="metadata-input"
                value={draft().definition.initial}
                onInput={(e) =>
                  setDraft((d) => ({
                    ...d,
                    definition: { ...d.definition, initial: e.currentTarget.value },
                  }))
                }
                placeholder="draft"
              />
            </div>
            <div class="metadata-toggle">
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft().active}
                  onChange={(e) => updateDraft({ active: e.currentTarget.checked })}
                />
                <span class="text-xs text-gray-600">Active</span>
              </label>
            </div>
          </div>
        </div>
      </Show>

      {/* Body: canvas + panel */}
      <div class="paper-body">
        <div class="diagram-container">
          <GraphCanvas
            layout={layout()}
            selectedNodeId={selectedState()}
            onSelectNode={setSelectedState}
          />
          <Show when={selectedState()}>
            <EditableStatePanel
              stateName={selectedState()!}
              isInitial={draft().definition.initial === selectedState()}
              allStates={allStates()}
              transitions={draft().definition.transitions}
              onRenameState={renameState}
              onSetInitial={setInitialState}
              onDeleteState={deleteState}
              onUpdateTransition={updateTransition}
              onAddTransition={addTransition}
              onDeleteTransition={deleteTransition}
              onClose={() => setSelectedState(null)}
            />
          </Show>
        </div>
      </div>
    </div>
  );
}

/** Helper: rename a state within a transition's `from` field */
function renameFrom(
  from: string | string[],
  oldName: string,
  newName: string,
): string | string[] {
  if (Array.isArray(from)) {
    return from.map((f) => (f === oldName ? newName : f));
  }
  return from === oldName ? newName : from;
}
