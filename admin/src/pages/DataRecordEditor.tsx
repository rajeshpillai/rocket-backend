import { createSignal, For, Show } from "solid-js";
import type { Field, EntityDefinition } from "../types/entity";

interface DataRecordEditorProps {
  entity: EntityDefinition;
  record: Record<string, unknown> | null; // null = create mode
  onSave: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}

function writableFields(entity: EntityDefinition, isCreate: boolean): Field[] {
  return entity.fields.filter((f) => {
    // Skip auto-generated timestamps
    if (f.auto) return false;
    // Skip auto-generated PK on create
    if (
      isCreate &&
      f.name === entity.primary_key.field &&
      entity.primary_key.generated
    ) {
      return false;
    }
    // Skip PK on update
    if (!isCreate && f.name === entity.primary_key.field) return false;
    return true;
  });
}

function inputType(fieldType: string): string {
  switch (fieldType) {
    case "int":
    case "bigint":
    case "decimal":
      return "number";
    case "boolean":
      return "checkbox";
    case "timestamp":
      return "datetime-local";
    case "date":
      return "date";
    default:
      return "text";
  }
}

export function DataRecordEditor(props: DataRecordEditorProps) {
  const isCreate = () => props.record === null;
  const fields = () => writableFields(props.entity, isCreate());

  const initialValues = (): Record<string, string> => {
    const vals: Record<string, string> = {};
    for (const f of fields()) {
      const raw = props.record?.[f.name];
      if (raw === null || raw === undefined) {
        vals[f.name] = "";
      } else if (typeof raw === "object") {
        vals[f.name] = JSON.stringify(raw);
      } else {
        vals[f.name] = String(raw);
      }
    }
    return vals;
  };

  const [values, setValues] = createSignal(initialValues());

  const updateValue = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = () => {
    const data: Record<string, unknown> = {};
    for (const f of fields()) {
      const raw = values()[f.name];
      if (raw === "" && !f.required) continue;

      switch (f.type) {
        case "int":
        case "bigint":
          data[f.name] = raw ? parseInt(raw, 10) : null;
          break;
        case "decimal":
          data[f.name] = raw ? parseFloat(raw) : null;
          break;
        case "boolean":
          data[f.name] = raw === "true" || raw === "on";
          break;
        case "json":
          try {
            data[f.name] = raw ? JSON.parse(raw) : null;
          } catch {
            data[f.name] = raw;
          }
          break;
        default:
          data[f.name] = raw || null;
      }
    }
    props.onSave(data);
  };

  return (
    <div class="flex flex-col gap-4">
      <Show when={props.error}>
        <div class="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {props.error}
        </div>
      </Show>

      <For each={fields()}>
        {(field) => (
          <div class="form-group">
            <label class="form-label">
              {field.name}
              {field.required && <span class="text-red-500 ml-1">*</span>}
              <span class="text-gray-400 ml-2 text-xs font-normal">
                {field.type}
              </span>
            </label>
            <Show
              when={field.type !== "boolean"}
              fallback={
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    class="form-checkbox"
                    checked={values()[field.name] === "true"}
                    onChange={(e) =>
                      updateValue(field.name, String(e.currentTarget.checked))
                    }
                  />
                  <span class="text-sm text-gray-600">
                    {values()[field.name] === "true" ? "true" : "false"}
                  </span>
                </label>
              }
            >
              <Show
                when={!field.enum || field.enum.length === 0}
                fallback={
                  <select
                    class="form-select"
                    value={values()[field.name]}
                    onChange={(e) => updateValue(field.name, e.currentTarget.value)}
                  >
                    <option value="">-- select --</option>
                    <For each={field.enum!}>
                      {(opt) => <option value={opt}>{opt}</option>}
                    </For>
                  </select>
                }
              >
                <Show
                  when={field.type !== "text" && field.type !== "json"}
                  fallback={
                    <textarea
                      class="form-input"
                      rows={field.type === "json" ? 5 : 3}
                      value={values()[field.name]}
                      onInput={(e) => updateValue(field.name, e.currentTarget.value)}
                      placeholder={field.type === "json" ? '{"key": "value"}' : ""}
                    />
                  }
                >
                  <input
                    type={inputType(field.type)}
                    class="form-input"
                    value={values()[field.name]}
                    onInput={(e) => updateValue(field.name, e.currentTarget.value)}
                  />
                </Show>
              </Show>
            </Show>
          </div>
        )}
      </For>

      <div class="modal-footer" style="padding: 0; border: none; margin-top: 0.5rem;">
        <button class="btn-secondary" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          class="btn-primary"
          onClick={handleSubmit}
          disabled={props.saving}
        >
          {props.saving ? "Saving..." : isCreate() ? "Create" : "Update"}
        </button>
      </div>
    </div>
  );
}
