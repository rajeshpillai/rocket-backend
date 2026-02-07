import { createSignal, onMount, For, Show } from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import { getEntity, createEntity, updateEntity } from "../api/entities";
import { parseDefinition, type EntityDefinition, type Field, type FieldType } from "../types/entity";
import { isApiError } from "../types/api";
import { FieldRow } from "../components/entity/field-row";
import { Toggle } from "../components/form/toggle";
import { SelectInput } from "../components/form/select-input";
import { addToast } from "../stores/notifications";
import { useEntities } from "../stores/entities";

const emptyField = (): Field => ({
  name: "",
  type: "string",
});

const defaultDefinition = (): EntityDefinition => ({
  name: "",
  table: "",
  primary_key: { field: "id", type: "uuid", generated: true },
  soft_delete: true,
  fields: [{ name: "id", type: "uuid", required: true }],
});

export function EntityDetail() {
  const params = useParams<{ name?: string }>();
  const navigate = useNavigate();
  const { load: reloadEntities } = useEntities();

  const isNew = () => !params.name || params.name === "new";

  const [definition, setDefinition] = createSignal<EntityDefinition>(defaultDefinition());
  const [saving, setSaving] = createSignal(false);
  const [loadingData, setLoadingData] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    if (!isNew()) {
      setLoadingData(true);
      try {
        const res = await getEntity(params.name!);
        const def = parseDefinition(res.data);
        setDefinition(def);
      } catch (err) {
        if (isApiError(err)) {
          addToast("error", err.error.message);
        } else {
          addToast("error", "Failed to load entity");
        }
      } finally {
        setLoadingData(false);
      }
    }
  });

  const updateDef = (partial: Partial<EntityDefinition>) => {
    setDefinition((prev) => ({ ...prev, ...partial }));
  };

  const updateField = (index: number, field: Field) => {
    setDefinition((prev) => {
      const fields = [...prev.fields];
      fields[index] = field;
      return { ...prev, fields };
    });
  };

  const removeField = (index: number) => {
    setDefinition((prev) => ({
      ...prev,
      fields: prev.fields.filter((_, i) => i !== index),
    }));
  };

  const addField = () => {
    setDefinition((prev) => ({
      ...prev,
      fields: [...prev.fields, emptyField()],
    }));
  };

  const handleSave = async () => {
    const def = definition();

    if (!def.name.trim()) {
      setError("Entity name is required");
      return;
    }
    if (def.fields.length === 0) {
      setError("Entity must have at least one field");
      return;
    }
    if (def.fields.some((f) => !f.name.trim())) {
      setError("All fields must have a name");
      return;
    }

    // Auto-set table name if empty
    const payload: EntityDefinition = {
      ...def,
      table: def.table.trim() || def.name.trim(),
    };

    setError(null);
    setSaving(true);

    try {
      if (isNew()) {
        await createEntity(payload);
        addToast("success", `Entity "${payload.name}" created`);
        await reloadEntities();
        navigate(`/entities/${payload.name}`);
      } else {
        await updateEntity(params.name!, payload);
        addToast("success", `Entity "${payload.name}" updated`);
        await reloadEntities();
      }
    } catch (err) {
      if (isApiError(err)) {
        setError(err.error.message);
        if (err.error.details) {
          const msgs = err.error.details.map(
            (d) => `${d.field ?? ""}: ${d.message}`,
          );
          setError(msgs.join("; "));
        }
      } else {
        setError("Failed to save entity");
      }
    } finally {
      setSaving(false);
    }
  };

  const pkFieldOptions = () =>
    definition().fields.map((f) => ({ value: f.name, label: f.name }));

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">
            {isNew() ? "Create Entity" : `Entity: ${params.name}`}
          </h1>
        </div>
        <div class="flex items-center gap-3">
          <button class="btn-secondary" onClick={() => navigate("/entities")}>
            Back
          </button>
          <button
            class="btn-primary"
            onClick={handleSave}
            disabled={saving()}
          >
            {saving() ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <Show when={error()}>
        <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error()}
        </div>
      </Show>

      <Show when={!loadingData()} fallback={<p class="text-sm text-gray-500">Loading...</p>}>
        {/* Settings Section */}
        <div class="section">
          <h2 class="section-title">Settings</h2>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Entity Name</label>
              <input
                type="text"
                class="form-input"
                value={definition().name}
                onInput={(e) => updateDef({ name: e.currentTarget.value })}
                placeholder="e.g. invoice"
                disabled={!isNew()}
              />
            </div>
            <div class="form-group">
              <label class="form-label">Table Name</label>
              <input
                type="text"
                class="form-input"
                value={definition().table}
                onInput={(e) => updateDef({ table: e.currentTarget.value })}
                placeholder="defaults to entity name"
              />
            </div>
          </div>
          <div class="mt-4">
            <Toggle
              label="Soft Delete"
              checked={definition().soft_delete}
              onChange={(val) => updateDef({ soft_delete: val })}
            />
          </div>
        </div>

        {/* Primary Key Section */}
        <div class="section">
          <h2 class="section-title">Primary Key</h2>
          <div class="form-row">
            <SelectInput
              label="Field"
              value={definition().primary_key.field}
              onChange={(val) =>
                updateDef({
                  primary_key: { ...definition().primary_key, field: val },
                })
              }
              options={pkFieldOptions()}
              placeholder="Select field"
            />
            <SelectInput
              label="Type"
              value={definition().primary_key.type}
              onChange={(val) =>
                updateDef({
                  primary_key: { ...definition().primary_key, type: val },
                })
              }
              options={[
                { value: "uuid", label: "uuid" },
                { value: "int", label: "int" },
                { value: "bigint", label: "bigint" },
                { value: "string", label: "string" },
              ]}
            />
          </div>
          <div class="mt-4">
            <Toggle
              label="Auto-generated"
              checked={definition().primary_key.generated}
              onChange={(val) =>
                updateDef({
                  primary_key: { ...definition().primary_key, generated: val },
                })
              }
            />
          </div>
        </div>

        {/* Fields Section */}
        <div class="section">
          <div class="flex items-center justify-between mb-4">
            <h2 class="section-title mb-0">Fields</h2>
            <button class="btn-secondary btn-sm" onClick={addField}>
              + Add Field
            </button>
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
              <For each={definition().fields}>
                {(field, i) => (
                  <FieldRow
                    field={field}
                    isPrimaryKey={field.name === definition().primary_key.field}
                    onChange={(f) => updateField(i(), f)}
                    onRemove={() => removeField(i())}
                  />
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );
}
