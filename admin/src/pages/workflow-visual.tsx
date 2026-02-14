import { createSignal, createMemo, Show, For, onMount, onCleanup } from "solid-js";
import type { WorkflowPayload, WorkflowStep, StepType } from "../types/workflow";
import { emptyStep, gotoDisplay } from "../types/workflow";
import { layoutWorkflow, type LayoutNode } from "../components/diagram/graph-layout";
import { GraphCanvas } from "../components/diagram/graph-canvas";
import { EditableStepPanel } from "../components/diagram/editable-step-panel";
import { createWorkflow, updateWorkflow } from "../api/workflows";
import { isApiError } from "../types/api";
import { addToast } from "../stores/notifications";

interface WorkflowVisualProps {
  wf: WorkflowPayload;
  onClose: () => void;
  editingId?: string | null;
  entityNames?: string[];
  onSaved?: () => void;
}

/** Remove goto references to a deleted step */
function cleanGotoRefs(step: WorkflowStep, deletedId: string): WorkflowStep {
  const clean = (val: any) => {
    if (!val) return val;
    const display = gotoDisplay(val);
    return display === deletedId ? undefined : val;
  };
  return {
    ...step,
    then: clean(step.then),
    on_true: clean(step.on_true),
    on_false: clean(step.on_false),
    on_approve: clean(step.on_approve),
    on_reject: clean(step.on_reject),
    on_timeout: clean(step.on_timeout),
  };
}

export function WorkflowVisual(props: WorkflowVisualProps) {
  const [draft, setDraft] = createSignal<WorkflowPayload>(
    JSON.parse(JSON.stringify(props.wf)),
  );
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [settingsOpen, setSettingsOpen] = createSignal(!props.editingId);
  const [addMenuOpen, setAddMenuOpen] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const layout = createMemo(() => layoutWorkflow(draft()));

  const selectedStep = createMemo((): WorkflowStep | null => {
    const id = selectedNodeId();
    if (!id) return null;
    return draft().steps.find((s) => s.id === id) ?? null;
  });

  const allStepIds = createMemo(() => draft().steps.map((s) => s.id).filter(Boolean));

  // --- Mutations ---
  const updateDraft = (partial: Partial<WorkflowPayload>) => {
    setDraft((d) => ({ ...d, ...partial }));
  };

  const updateTrigger = (partial: Partial<WorkflowPayload["trigger"]>) => {
    setDraft((d) => ({ ...d, trigger: { ...d.trigger, ...partial } }));
  };

  const updateStep = (stepId: string, partial: Partial<WorkflowStep>) => {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s) => (s.id === stepId ? { ...s, ...partial } : s)),
    }));
  };

  const addStep = (type: StepType) => {
    const step = emptyStep();
    step.type = type;
    step.id = `step_${Date.now() % 10000}`;
    setDraft((d) => ({ ...d, steps: [...d.steps, step] }));
    setSelectedNodeId(step.id);
    setAddMenuOpen(false);
  };

  const removeStep = (stepId: string) => {
    setDraft((d) => ({
      ...d,
      steps: d.steps
        .filter((s) => s.id !== stepId)
        .map((s) => cleanGotoRefs(s, stepId)),
    }));
    setSelectedNodeId(null);
  };

  // --- Save ---
  const handleSave = async () => {
    const wf = draft();
    if (!wf.name) {
      setError("Name is required");
      setSettingsOpen(true);
      return;
    }
    if (!wf.trigger.entity) {
      setError("Trigger entity is required");
      setSettingsOpen(true);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (props.editingId) {
        await updateWorkflow(props.editingId, wf);
        addToast("success", "Workflow updated");
      } else {
        await createWorkflow(wf);
        addToast("success", "Workflow created");
      }
      props.onSaved?.();
    } catch (err) {
      if (isApiError(err)) {
        setError(err.error.message);
      } else {
        setError("Failed to save workflow");
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
            {draft().name || "New Workflow"}
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

          {/* Add Step dropdown */}
          <div class="toolbar-dropdown">
            <button
              class="btn-secondary btn-sm"
              onClick={() => setAddMenuOpen((v) => !v)}
            >
              + Add Step
            </button>
            <Show when={addMenuOpen()}>
              <div class="toolbar-dropdown-menu">
                <button class="toolbar-dropdown-item" onClick={() => addStep("action")}>
                  Action
                </button>
                <button class="toolbar-dropdown-item" onClick={() => addStep("condition")}>
                  Condition
                </button>
                <button class="toolbar-dropdown-item" onClick={() => addStep("approval")}>
                  Approval
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
            <div class="metadata-field-wide">
              <label class="metadata-label">Name</label>
              <input
                class="metadata-input"
                value={draft().name}
                onInput={(e) => updateDraft({ name: e.currentTarget.value })}
                placeholder="Workflow name"
              />
            </div>
            <div class="metadata-field">
              <label class="metadata-label">Trigger Entity</label>
              <Show
                when={entityOptions().length > 0}
                fallback={
                  <input
                    class="metadata-input"
                    value={draft().trigger.entity}
                    onInput={(e) => updateTrigger({ entity: e.currentTarget.value })}
                    placeholder="entity_name"
                  />
                }
              >
                <select
                  class="metadata-select"
                  value={draft().trigger.entity}
                  onChange={(e) => updateTrigger({ entity: e.currentTarget.value })}
                >
                  <option value="">-- select --</option>
                  <For each={entityOptions()}>
                    {(name) => <option value={name}>{name}</option>}
                  </For>
                </select>
              </Show>
            </div>
            <div class="metadata-field">
              <label class="metadata-label">Trigger Field</label>
              <input
                class="metadata-input"
                value={draft().trigger.field ?? ""}
                onInput={(e) => updateTrigger({ field: e.currentTarget.value })}
                placeholder="status"
              />
            </div>
            <div class="metadata-field">
              <label class="metadata-label">Trigger To</label>
              <input
                class="metadata-input"
                value={draft().trigger.to ?? ""}
                onInput={(e) => updateTrigger({ to: e.currentTarget.value })}
                placeholder="approved"
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
            selectedNodeId={selectedNodeId()}
            onSelectNode={setSelectedNodeId}
          />
          <Show when={selectedStep()}>
            <EditableStepPanel
              step={selectedStep()!}
              allStepIds={allStepIds()}
              onUpdate={(partial) => updateStep(selectedNodeId()!, partial)}
              onDelete={() => removeStep(selectedNodeId()!)}
              onClose={() => setSelectedNodeId(null)}
            />
          </Show>
        </div>
      </div>
    </div>
  );
}
