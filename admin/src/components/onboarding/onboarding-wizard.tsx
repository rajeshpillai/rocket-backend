import { createSignal, Show, For, Switch, Match, onMount, onCleanup } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { createEntity } from "../../api/entities";
import { createRelation } from "../../api/relations";
import { createRecord } from "../../api/data";
import { useEntities } from "../../stores/entities";
import { useRelations } from "../../stores/relations";
import { addToast } from "../../stores/notifications";
import { isApiError } from "../../types/api";
import type { EntityDefinition, Field } from "../../types/entity";
import type { RelationDefinition } from "../../types/relation";
import { ENTITY_PRESETS, CUSTOM_PRESET_KEY, type EntityPreset } from "../../constants/entity-presets";
import { FIELD_TEMPLATES, type FieldTemplate } from "../../constants/field-templates";
import { FieldRow } from "../entity/field-row";
import { StepIndicator } from "./step-indicator";

type WizardStep =
  | "welcome"
  | "choose-preset"
  | "configure-entity"
  | "second-entity"
  | "create-relation"
  | "sample-data"
  | "complete";

const STEP_ORDER: WizardStep[] = [
  "welcome",
  "choose-preset",
  "configure-entity",
  "second-entity",
  "create-relation",
  "sample-data",
  "complete",
];

interface OnboardingWizardProps {
  onDismiss: () => void;
}

const defaultEntity = (): EntityDefinition => ({
  name: "",
  table: "",
  primary_key: { field: "id", type: "uuid", generated: true },
  soft_delete: true,
  fields: [
    { name: "id", type: "uuid", required: true },
    { name: "created_at", type: "timestamp", required: true, auto: "create" },
    { name: "updated_at", type: "timestamp", required: true, auto: "update" },
  ],
});

function presetToEntity(preset: EntityPreset): EntityDefinition {
  return {
    name: preset.name,
    table: preset.name,
    primary_key: { field: "id", type: "uuid", generated: true },
    soft_delete: true,
    fields: preset.fields.map((f) => ({ ...f })),
  };
}

function presetToRelatedEntity(preset: EntityPreset): EntityDefinition | null {
  if (!preset.relatedEntity) return null;
  return {
    name: preset.relatedEntity.name,
    table: preset.relatedEntity.name,
    primary_key: { field: "id", type: "uuid", generated: true },
    soft_delete: true,
    fields: preset.relatedEntity.fields.map((f) => ({ ...f })),
  };
}

export function OnboardingWizard(props: OnboardingWizardProps) {
  const navigate = useNavigate();
  const { load: reloadEntities } = useEntities();
  const { load: reloadRelations } = useRelations();

  const [step, setStep] = createSignal<WizardStep>("welcome");
  const [selectedPresetKey, setSelectedPresetKey] = createSignal<string | null>(null);
  const [entity1, setEntity1] = createSignal<EntityDefinition>(defaultEntity());
  const [entity2, setEntity2] = createSignal<EntityDefinition | null>(null);
  const [sampleRecords1, setSampleRecords1] = createSignal<Record<string, unknown>[]>([]);
  const [sampleRecords2, setSampleRecords2] = createSignal<Record<string, unknown>[]>([]);
  const [entity1Created, setEntity1Created] = createSignal(false);
  const [entity2Created, setEntity2Created] = createSignal(false);
  const [relationCreated, setRelationCreated] = createSignal(false);
  const [samplesInserted, setSamplesInserted] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [insertProgress, setInsertProgress] = createSignal<string | null>(null);

  const stepIndex = () => STEP_ORDER.indexOf(step());

  const selectedPreset = () => {
    const key = selectedPresetKey();
    if (!key || key === CUSTOM_PRESET_KEY) return null;
    return ENTITY_PRESETS.find((p) => p.name === key) ?? null;
  };

  const hasRelatedEntity = () => {
    const preset = selectedPreset();
    return preset?.relatedEntity != null;
  };

  // --- Entity field helpers ---

  const updateEntity1 = (partial: Partial<EntityDefinition>) => {
    setEntity1((prev) => ({ ...prev, ...partial }));
  };

  const updateEntity1Field = (index: number, field: Field) => {
    setEntity1((prev) => {
      const fields = [...prev.fields];
      fields[index] = field;
      return { ...prev, fields };
    });
  };

  const removeEntity1Field = (index: number) => {
    setEntity1((prev) => ({
      ...prev,
      fields: prev.fields.filter((_, i) => i !== index),
    }));
  };

  const addEntity1Field = () => {
    setEntity1((prev) => ({
      ...prev,
      fields: [...prev.fields, { name: "", type: "string" as const }],
    }));
  };

  const updateEntity2 = (partial: Partial<EntityDefinition>) => {
    setEntity2((prev) => prev ? { ...prev, ...partial } : prev);
  };

  const updateEntity2Field = (index: number, field: Field) => {
    setEntity2((prev) => {
      if (!prev) return prev;
      const fields = [...prev.fields];
      fields[index] = field;
      return { ...prev, fields };
    });
  };

  const removeEntity2Field = (index: number) => {
    setEntity2((prev) =>
      prev ? { ...prev, fields: prev.fields.filter((_, i) => i !== index) } : prev,
    );
  };

  const addEntity2Field = () => {
    setEntity2((prev) =>
      prev ? { ...prev, fields: [...prev.fields, { name: "", type: "string" as const }] } : prev,
    );
  };

  // Quick Add dropdown
  const [quickAddOpen1, setQuickAddOpen1] = createSignal(false);
  const [quickAddOpen2, setQuickAddOpen2] = createSignal(false);
  let quickAddRef1: HTMLDivElement | undefined;
  let quickAddRef2: HTMLDivElement | undefined;

  const handleClickOutside = (e: MouseEvent) => {
    if (quickAddRef1 && !quickAddRef1.contains(e.target as Node)) setQuickAddOpen1(false);
    if (quickAddRef2 && !quickAddRef2.contains(e.target as Node)) setQuickAddOpen2(false);
  };

  onMount(() => document.addEventListener("mousedown", handleClickOutside));
  onCleanup(() => document.removeEventListener("mousedown", handleClickOutside));

  const applyTemplate1 = (template: FieldTemplate) => {
    const existing = new Set(entity1().fields.map((f) => f.name));
    const newFields = template.fields.filter((f) => !existing.has(f.name));
    if (newFields.length === 0) {
      addToast("success", `All fields from "${template.label}" already exist`);
      return;
    }
    setEntity1((prev) => ({
      ...prev,
      fields: [...prev.fields, ...newFields.map((f) => ({ ...f }))],
    }));
    addToast("success", `Added ${newFields.length} field(s) from "${template.label}"`);
  };

  const applyTemplate2 = (template: FieldTemplate) => {
    const e2 = entity2();
    if (!e2) return;
    const existing = new Set(e2.fields.map((f) => f.name));
    const newFields = template.fields.filter((f) => !existing.has(f.name));
    if (newFields.length === 0) {
      addToast("success", `All fields from "${template.label}" already exist`);
      return;
    }
    setEntity2((prev) =>
      prev ? { ...prev, fields: [...prev.fields, ...newFields.map((f) => ({ ...f }))] } : prev,
    );
    addToast("success", `Added ${newFields.length} field(s) from "${template.label}"`);
  };

  // --- Preset selection ---

  const selectPreset = (key: string) => {
    setSelectedPresetKey(key);
    if (key === CUSTOM_PRESET_KEY) {
      setEntity1(defaultEntity());
      setEntity2(null);
      setSampleRecords1([]);
      setSampleRecords2([]);
    } else {
      const preset = ENTITY_PRESETS.find((p) => p.name === key)!;
      setEntity1(presetToEntity(preset));
      setEntity2(presetToRelatedEntity(preset));
      setSampleRecords1(preset.sampleRecords.map((r) => ({ ...r })));
      setSampleRecords2(
        preset.relatedEntity?.sampleRecords.map((r) => ({ ...r })) ?? [],
      );
    }
    setStep("configure-entity");
  };

  // --- API calls ---

  const handleCreateEntity1 = async () => {
    const def = entity1();
    if (!def.name.trim()) {
      setError("Entity name is required");
      return;
    }
    if (def.fields.some((f) => !f.name.trim())) {
      setError("All fields must have a name");
      return;
    }

    const payload: EntityDefinition = {
      ...def,
      table: def.table.trim() || def.name.trim(),
    };

    setSaving(true);
    setError(null);
    try {
      await createEntity(payload);
      setEntity1Created(true);
      await reloadEntities();
      addToast("success", `Entity "${payload.name}" created`);
      if (hasRelatedEntity()) {
        setStep("second-entity");
      } else {
        setStep("sample-data");
      }
    } catch (err) {
      if (isApiError(err)) {
        setError(err.error.message);
      } else {
        setError("Failed to create entity");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCreateEntity2 = async () => {
    const def = entity2();
    if (!def) return;
    if (!def.name.trim()) {
      setError("Entity name is required");
      return;
    }

    const payload: EntityDefinition = {
      ...def,
      table: def.table.trim() || def.name.trim(),
    };

    setSaving(true);
    setError(null);
    try {
      await createEntity(payload);
      setEntity2Created(true);
      await reloadEntities();
      addToast("success", `Entity "${payload.name}" created`);
      setStep("create-relation");
    } catch (err) {
      if (isApiError(err)) {
        setError(err.error.message);
      } else {
        setError("Failed to create entity");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRelation = async () => {
    const preset = selectedPreset();
    if (!preset?.relation) return;

    const def: RelationDefinition = {
      name: preset.relation.name,
      type: preset.relation.type,
      source: entity1().name,
      target: entity2()?.name ?? "",
      source_key: preset.relation.sourceKey,
      target_key: preset.relation.targetKey,
      ownership: preset.relation.ownership,
      on_delete: preset.relation.onDelete,
    };

    setSaving(true);
    setError(null);
    try {
      await createRelation(def);
      setRelationCreated(true);
      await reloadRelations();
      addToast("success", `Relation "${def.name}" created`);
      setStep("sample-data");
    } catch (err) {
      if (isApiError(err)) {
        setError(err.error.message);
      } else {
        setError("Failed to create relation");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleInsertSamples = async () => {
    setSaving(true);
    setError(null);
    let totalInserted = 0;
    const e1Name = entity1().name;

    try {
      // Insert entity1 records
      const records1 = sampleRecords1();
      const createdIds: string[] = [];
      for (let i = 0; i < records1.length; i++) {
        setInsertProgress(`Inserting ${e1Name} ${i + 1} of ${records1.length}...`);
        try {
          const res = await createRecord(e1Name, records1[i]);
          totalInserted++;
          if (res.data?.id) createdIds.push(String(res.data.id));
        } catch (err) {
          if (isApiError(err)) {
            addToast("error", `${e1Name} record ${i + 1}: ${err.error.message}`);
          }
        }
      }

      // Insert entity2 records (link to first entity1 record if possible)
      const e2 = entity2();
      const records2 = sampleRecords2();
      if (e2 && records2.length > 0 && entity2Created()) {
        const preset = selectedPreset();
        const fkField = preset?.relation?.targetKey;
        const parentId = createdIds[0];
        for (let i = 0; i < records2.length; i++) {
          setInsertProgress(`Inserting ${e2.name} ${i + 1} of ${records2.length}...`);
          try {
            const data = { ...records2[i] };
            if (fkField && parentId) {
              data[fkField] = parentId;
            }
            await createRecord(e2.name, data);
            totalInserted++;
          } catch (err) {
            if (isApiError(err)) {
              addToast("error", `${e2.name} record ${i + 1}: ${err.error.message}`);
            }
          }
        }
      }

      setSamplesInserted(true);
      addToast("success", `Inserted ${totalInserted} sample record(s)`);
      setStep("complete");
    } finally {
      setSaving(false);
      setInsertProgress(null);
    }
  };

  // --- Writable fields for sample preview (skip auto/PK) ---
  const previewFields = (def: EntityDefinition) =>
    def.fields.filter((f) => !f.auto && f.name !== def.primary_key.field);

  // --- Count summary for completion ---
  const createdEntities = () => (entity1Created() ? 1 : 0) + (entity2Created() ? 1 : 0);
  const createdRelations = () => (relationCreated() ? 1 : 0);
  const insertedRecords = () =>
    (samplesInserted() ? sampleRecords1().length + (entity2Created() ? sampleRecords2().length : 0) : 0);

  // --- Render ---

  return (
    <div class="wizard-container">
      <div class="wizard-header">
        <div>
          <h1 class="wizard-title">Get Started</h1>
          <p class="wizard-subtitle">Set up your first entity in a few steps</p>
        </div>
        <button class="wizard-skip" onClick={props.onDismiss}>
          Skip wizard
        </button>
      </div>

      <StepIndicator steps={STEP_ORDER} currentIndex={stepIndex()} />

      <Show when={error()}>
        <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error()}
        </div>
      </Show>

      <Switch>
        {/* ── Step 1: Welcome ────────────────────────────── */}
        <Match when={step() === "welcome"}>
          <div class="wizard-step-content">
            <h2 class="wizard-step-title">Welcome to your new app</h2>
            <p class="wizard-step-description">
              This wizard will help you create your first data entity. Here are the key concepts:
            </p>
            <div class="concept-grid">
              <div class="concept-card">
                <div class="concept-card-title">Entities</div>
                <div class="concept-card-desc">
                  An entity is like a database table. It defines the structure of your data — for example, "customer", "product", or "task".
                </div>
              </div>
              <div class="concept-card">
                <div class="concept-card-title">Fields</div>
                <div class="concept-card-desc">
                  Fields are the columns of your entity. Each field has a name and type — like "email" (string), "price" (decimal), or "active" (boolean).
                </div>
              </div>
              <div class="concept-card">
                <div class="concept-card-title">Relations</div>
                <div class="concept-card-desc">
                  Relations connect entities together. For example, a customer can have many orders — that's a one-to-many relation.
                </div>
              </div>
              <div class="concept-card">
                <div class="concept-card-title">REST API</div>
                <div class="concept-card-desc">
                  Once created, each entity automatically gets a full REST API — list, get, create, update, and delete — with zero extra code.
                </div>
              </div>
            </div>
            <div class="wizard-footer">
              <div />
              <button class="btn-primary" onClick={() => setStep("choose-preset")}>
                Get Started
              </button>
            </div>
          </div>
        </Match>

        {/* ── Step 2: Choose Preset ──────────────────────── */}
        <Match when={step() === "choose-preset"}>
          <div class="wizard-step-content">
            <h2 class="wizard-step-title">Choose a template</h2>
            <p class="wizard-step-description">
              Pick a starting template, or start from scratch with a custom entity.
            </p>
            <div class="preset-grid">
              <For each={ENTITY_PRESETS}>
                {(preset) => (
                  <button
                    class={`preset-card ${selectedPresetKey() === preset.name ? "preset-card-selected" : ""}`}
                    onClick={() => selectPreset(preset.name)}
                  >
                    <div class="preset-card-name">{preset.displayName}</div>
                    <div class="preset-card-desc">{preset.description}</div>
                    <div class="preset-card-meta">
                      {preset.fields.length - 1} fields
                      {preset.relatedEntity ? ` + ${preset.relatedEntity.name} entity` : ""}
                    </div>
                  </button>
                )}
              </For>
              <button
                class={`preset-card ${selectedPresetKey() === CUSTOM_PRESET_KEY ? "preset-card-selected" : ""}`}
                onClick={() => selectPreset(CUSTOM_PRESET_KEY)}
              >
                <div class="preset-card-name">Start from Scratch</div>
                <div class="preset-card-desc">Define your own entity with custom fields</div>
                <div class="preset-card-meta">id + timestamps</div>
              </button>
            </div>
            <div class="wizard-footer">
              <button class="btn-secondary" onClick={() => setStep("welcome")}>
                Back
              </button>
              <div />
            </div>
          </div>
        </Match>

        {/* ── Step 3: Configure Entity ───────────────────── */}
        <Match when={step() === "configure-entity"}>
          <div class="wizard-step-content">
            <h2 class="wizard-step-title">Configure your entity</h2>
            <p class="wizard-step-description">
              Set the name and fields for your entity. You can always edit these later.
            </p>

            <div class="form-row mb-4">
              <div class="form-group">
                <label class="form-label">Entity Name</label>
                <input
                  type="text"
                  class="form-input"
                  value={entity1().name}
                  onInput={(e) => updateEntity1({ name: e.currentTarget.value })}
                  placeholder="e.g. customer"
                />
              </div>
              <div class="form-group">
                <label class="form-label">Table Name</label>
                <input
                  type="text"
                  class="form-input"
                  value={entity1().table}
                  onInput={(e) => updateEntity1({ table: e.currentTarget.value })}
                  placeholder="defaults to entity name"
                />
              </div>
            </div>

            <div class="flex items-center justify-between mb-3">
              <h3 class="text-sm font-semibold text-gray-700">Fields</h3>
              <div class="flex items-center gap-2">
                <div class="quick-add-wrap" ref={quickAddRef1}>
                  <button
                    class="btn-secondary btn-sm"
                    onClick={() => setQuickAddOpen1(!quickAddOpen1())}
                  >
                    Quick Add &#9662;
                  </button>
                  <Show when={quickAddOpen1()}>
                    <div class="quick-add-menu">
                      <For each={FIELD_TEMPLATES}>
                        {(tpl) => (
                          <button
                            class="quick-add-item"
                            onClick={() => { applyTemplate1(tpl); setQuickAddOpen1(false); }}
                          >
                            <span class="quick-add-item-label">{tpl.label}</span>
                            <span class="quick-add-item-desc">{tpl.description}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
                <button class="btn-secondary btn-sm" onClick={addEntity1Field}>
                  + Add Field
                </button>
              </div>
            </div>

            <table class="data-table">
              <thead class="table-header">
                <tr>
                  <th class="table-header-cell">Name</th>
                  <th class="table-header-cell">Type</th>
                  <th class="table-header-cell text-center">Required</th>
                  <th class="table-header-cell text-center">Unique</th>
                  <th class="table-header-cell">Default</th>
                  <th class="table-header-cell">Enum</th>
                  <th class="table-header-cell"></th>
                </tr>
              </thead>
              <tbody class="table-body">
                <For each={entity1().fields}>
                  {(field, i) => (
                    <FieldRow
                      field={field}
                      isPrimaryKey={field.name === entity1().primary_key.field}
                      onChange={(f) => updateEntity1Field(i(), f)}
                      onRemove={() => removeEntity1Field(i())}
                    />
                  )}
                </For>
              </tbody>
            </table>

            <div class="wizard-footer">
              <button class="btn-secondary" onClick={() => setStep("choose-preset")}>
                Back
              </button>
              <div class="wizard-footer-right">
                <button
                  class="btn-primary"
                  onClick={handleCreateEntity1}
                  disabled={saving()}
                >
                  {saving() ? "Creating..." : "Create Entity"}
                </button>
              </div>
            </div>
          </div>
        </Match>

        {/* ── Step 4: Second Entity ──────────────────────── */}
        <Match when={step() === "second-entity"}>
          <Show when={entity2()}>
            {(e2) => (
              <div class="wizard-step-content">
                <h2 class="wizard-step-title">Create related entity</h2>
                <p class="wizard-step-description">
                  This entity will be linked to "{entity1().name}" via a relation.
                  You can skip this step if you prefer.
                </p>

                <div class="form-row mb-4">
                  <div class="form-group">
                    <label class="form-label">Entity Name</label>
                    <input
                      type="text"
                      class="form-input"
                      value={e2().name}
                      onInput={(e) => updateEntity2({ name: e.currentTarget.value })}
                      placeholder="e.g. order"
                    />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Table Name</label>
                    <input
                      type="text"
                      class="form-input"
                      value={e2().table}
                      onInput={(e) => updateEntity2({ table: e.currentTarget.value })}
                      placeholder="defaults to entity name"
                    />
                  </div>
                </div>

                <div class="flex items-center justify-between mb-3">
                  <h3 class="text-sm font-semibold text-gray-700">Fields</h3>
                  <div class="flex items-center gap-2">
                    <div class="quick-add-wrap" ref={quickAddRef2}>
                      <button
                        class="btn-secondary btn-sm"
                        onClick={() => setQuickAddOpen2(!quickAddOpen2())}
                      >
                        Quick Add &#9662;
                      </button>
                      <Show when={quickAddOpen2()}>
                        <div class="quick-add-menu">
                          <For each={FIELD_TEMPLATES}>
                            {(tpl) => (
                              <button
                                class="quick-add-item"
                                onClick={() => { applyTemplate2(tpl); setQuickAddOpen2(false); }}
                              >
                                <span class="quick-add-item-label">{tpl.label}</span>
                                <span class="quick-add-item-desc">{tpl.description}</span>
                              </button>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                    <button class="btn-secondary btn-sm" onClick={addEntity2Field}>
                      + Add Field
                    </button>
                  </div>
                </div>

                <table class="data-table">
                  <thead class="table-header">
                    <tr>
                      <th class="table-header-cell">Name</th>
                      <th class="table-header-cell">Type</th>
                      <th class="table-header-cell text-center">Required</th>
                      <th class="table-header-cell text-center">Unique</th>
                      <th class="table-header-cell">Default</th>
                      <th class="table-header-cell">Enum</th>
                      <th class="table-header-cell"></th>
                    </tr>
                  </thead>
                  <tbody class="table-body">
                    <For each={e2().fields}>
                      {(field, i) => (
                        <FieldRow
                          field={field}
                          isPrimaryKey={field.name === e2().primary_key.field}
                          onChange={(f) => updateEntity2Field(i(), f)}
                          onRemove={() => removeEntity2Field(i())}
                        />
                      )}
                    </For>
                  </tbody>
                </table>

                <div class="wizard-footer">
                  <button class="btn-secondary" onClick={() => setStep("configure-entity")}>
                    Back
                  </button>
                  <div class="wizard-footer-right">
                    <button
                      class="btn-secondary"
                      onClick={() => setStep("sample-data")}
                    >
                      Skip
                    </button>
                    <button
                      class="btn-primary"
                      onClick={handleCreateEntity2}
                      disabled={saving()}
                    >
                      {saving() ? "Creating..." : "Create Entity"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Show>
        </Match>

        {/* ── Step 5: Create Relation ────────────────────── */}
        <Match when={step() === "create-relation"}>
          <div class="wizard-step-content">
            <h2 class="wizard-step-title">Create relation</h2>
            <p class="wizard-step-description">
              Link "{entity1().name}" to "{entity2()?.name}" so you can query them together.
            </p>

            <Show when={selectedPreset()?.relation}>
              {(rel) => (
                <div class="space-y-4">
                  <div class="form-row">
                    <div class="form-group">
                      <label class="form-label">Relation Name</label>
                      <input type="text" class="form-input" value={rel().name} disabled />
                    </div>
                    <div class="form-group">
                      <label class="form-label">Type</label>
                      <input type="text" class="form-input" value={rel().type.replace(/_/g, " ")} disabled />
                    </div>
                  </div>
                  <div class="form-row">
                    <div class="form-group">
                      <label class="form-label">Source</label>
                      <input type="text" class="form-input" value={`${entity1().name}.${rel().sourceKey}`} disabled />
                    </div>
                    <div class="form-group">
                      <label class="form-label">Target</label>
                      <input type="text" class="form-input" value={`${entity2()?.name ?? ""}.${rel().targetKey}`} disabled />
                    </div>
                  </div>
                </div>
              )}
            </Show>

            <div class="wizard-footer">
              <button class="btn-secondary" onClick={() => setStep("second-entity")}>
                Back
              </button>
              <div class="wizard-footer-right">
                <button
                  class="btn-secondary"
                  onClick={() => setStep("sample-data")}
                >
                  Skip
                </button>
                <button
                  class="btn-primary"
                  onClick={handleCreateRelation}
                  disabled={saving()}
                >
                  {saving() ? "Creating..." : "Create Relation"}
                </button>
              </div>
            </div>
          </div>
        </Match>

        {/* ── Step 6: Sample Data ────────────────────────── */}
        <Match when={step() === "sample-data"}>
          <div class="wizard-step-content">
            <h2 class="wizard-step-title">Insert sample data</h2>
            <p class="wizard-step-description">
              {sampleRecords1().length > 0
                ? `Insert ${sampleRecords1().length} sample record(s) into "${entity1().name}" to see your API in action.`
                : "No sample data configured. You can skip this step and add records later via the Data Browser."}
            </p>

            <Show when={sampleRecords1().length > 0}>
              <div class="mb-4">
                <h3 class="text-sm font-semibold text-gray-700 mb-2">{entity1().name}</h3>
                <div class="overflow-x-auto border border-gray-200 rounded-lg">
                  <table class="data-table">
                    <thead class="table-header">
                      <tr>
                        <For each={previewFields(entity1())}>
                          {(f) => <th class="table-header-cell">{f.name}</th>}
                        </For>
                      </tr>
                    </thead>
                    <tbody class="table-body">
                      <For each={sampleRecords1()}>
                        {(rec) => (
                          <tr class="table-row">
                            <For each={previewFields(entity1())}>
                              {(f) => (
                                <td class="table-cell text-sm">
                                  {rec[f.name] !== undefined ? String(rec[f.name]) : ""}
                                </td>
                              )}
                            </For>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </div>
            </Show>

            <Show when={entity2Created() && sampleRecords2().length > 0}>
              <div class="mb-4">
                <h3 class="text-sm font-semibold text-gray-700 mb-2">{entity2()?.name}</h3>
                <div class="overflow-x-auto border border-gray-200 rounded-lg">
                  <table class="data-table">
                    <thead class="table-header">
                      <tr>
                        <For each={previewFields(entity2()!)}>
                          {(f) => <th class="table-header-cell">{f.name}</th>}
                        </For>
                      </tr>
                    </thead>
                    <tbody class="table-body">
                      <For each={sampleRecords2()}>
                        {(rec) => (
                          <tr class="table-row">
                            <For each={previewFields(entity2()!)}>
                              {(f) => (
                                <td class="table-cell text-sm">
                                  {rec[f.name] !== undefined ? String(rec[f.name]) : ""}
                                </td>
                              )}
                            </For>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </div>
            </Show>

            <Show when={insertProgress()}>
              <p class="text-sm text-blue-600 mb-2">{insertProgress()}</p>
            </Show>

            <div class="wizard-footer">
              <button
                class="btn-secondary"
                onClick={() => {
                  if (relationCreated()) setStep("create-relation");
                  else if (entity2Created()) setStep("second-entity");
                  else setStep("configure-entity");
                }}
              >
                Back
              </button>
              <div class="wizard-footer-right">
                <button
                  class="btn-secondary"
                  onClick={() => {
                    props.onDismiss();
                    setStep("complete");
                  }}
                >
                  Skip
                </button>
                <Show when={sampleRecords1().length > 0}>
                  <button
                    class="btn-primary"
                    onClick={handleInsertSamples}
                    disabled={saving()}
                  >
                    {saving() ? "Inserting..." : "Insert Sample Data"}
                  </button>
                </Show>
              </div>
            </div>
          </div>
        </Match>

        {/* ── Step 7: Complete ───────────────────────────── */}
        <Match when={step() === "complete"}>
          <div class="wizard-step-content text-center">
            <div class="text-5xl mb-4">&#10003;</div>
            <h2 class="wizard-step-title">Your app is ready!</h2>
            <p class="wizard-step-description">
              You've set up your first {createdEntities() > 1 ? "entities" : "entity"}.
              Your REST API endpoints are live and ready to use.
            </p>

            <div class="completion-summary">
              <div class="completion-stat">
                <div class="completion-stat-value">{createdEntities()}</div>
                <div class="completion-stat-label">{createdEntities() === 1 ? "Entity" : "Entities"}</div>
              </div>
              <Show when={createdRelations() > 0}>
                <div class="completion-stat">
                  <div class="completion-stat-value">{createdRelations()}</div>
                  <div class="completion-stat-label">Relation</div>
                </div>
              </Show>
              <Show when={insertedRecords() > 0}>
                <div class="completion-stat">
                  <div class="completion-stat-value">{insertedRecords()}</div>
                  <div class="completion-stat-label">Records</div>
                </div>
              </Show>
            </div>

            <div class="flex items-center justify-center gap-3 mt-8">
              <button
                class="btn-secondary"
                onClick={() => {
                  props.onDismiss();
                }}
              >
                Manage Entities
              </button>
              <button
                class="btn-primary"
                onClick={() => {
                  props.onDismiss();
                  navigate(`/data/${entity1().name}`);
                }}
              >
                Browse Data
              </button>
            </div>
          </div>
        </Match>
      </Switch>
    </div>
  );
}
