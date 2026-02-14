import { createSignal, For, Show } from "solid-js";
import type { EntityDefinition } from "../types/entity";
import type { RelationDefinition } from "../types/relation";
import { FileUploadField } from "../components/form/file-upload-field";
import { RelatedRecordsEditor, type ChildRecordState } from "../components/form/related-records-editor";
import { writableFields, inputType, coerceFieldValue } from "../utils/field-helpers";

interface DataRecordEditorProps {
  entity: EntityDefinition;
  record: Record<string, unknown> | null; // null = create mode
  onSave: (data: Record<string, unknown>) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
  relations?: RelationDefinition[];
  allEntities?: EntityDefinition[];
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
  const [relationData, setRelationData] = createSignal<Record<string, ChildRecordState[]>>({});
  const [writeModes, setWriteModes] = createSignal<Record<string, string>>({});

  const updateValue = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleRelationChange = (relName: string, children: ChildRecordState[]) => {
    setRelationData((prev) => ({ ...prev, [relName]: children }));
  };

  const handleWriteModeChange = (relName: string, mode: string) => {
    setWriteModes((prev) => ({ ...prev, [relName]: mode }));
  };

  const handleSubmit = () => {
    const data: Record<string, unknown> = {};

    // Parent fields
    for (const f of fields()) {
      const raw = values()[f.name];
      const val = coerceFieldValue(raw, f);
      if (val !== undefined) {
        data[f.name] = val;
      }
    }

    // Nested write payloads for each relation
    const rels = props.relations ?? [];
    const allEnts = props.allEntities ?? [];

    for (const rel of rels) {
      const children = relationData()[rel.name];
      if (!children || children.length === 0) continue;

      const targetEntity = allEnts.find((e) => e.name === rel.target);
      const targetPK = targetEntity?.primary_key.field ?? "id";
      const mode = writeModes()[rel.name] ?? rel.write_mode ?? "diff";

      const items: Record<string, unknown>[] = [];

      for (const child of children) {
        if (child._status === "deleted") {
          const pk = child.data[targetPK];
          if (pk) {
            items.push({ [targetPK]: pk, _delete: true });
          }
        } else if (child._status === "new") {
          const row: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(child.data)) {
            // Skip auto-generated PK
            if (k === targetPK && targetEntity?.primary_key.generated) continue;
            // Skip FK to parent (backend auto-propagates)
            if (k === rel.target_key) continue;
            row[k] = v;
          }
          items.push(row);
        } else {
          // existing: send full data including PK for UPDATE
          items.push({ ...child.data });
        }
      }

      if (items.length > 0) {
        data[rel.name] = {
          _write_mode: mode,
          data: items,
        };
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
              when={field.type !== "file"}
              fallback={
                <FileUploadField
                  label={field.name}
                  value={values()[field.name]}
                  onChange={(fileId) => updateValue(field.name, fileId)}
                  required={field.required}
                />
              }
            >
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
            </Show>
          </div>
        )}
      </For>

      {/* Related records sections */}
      <Show when={props.relations && props.relations.length > 0 && props.allEntities}>
        <For each={props.relations!}>
          {(rel) => {
            const targetEntity = () =>
              props.allEntities!.find((e) => e.name === rel.target);
            const existingRecords = () => {
              const val = props.record?.[rel.name];
              if (Array.isArray(val)) return val as Record<string, unknown>[];
              if (val && typeof val === "object" && !Array.isArray(val)) {
                return [val as Record<string, unknown>];
              }
              return [];
            };
            return (
              <Show when={targetEntity()}>
                {(te) => (
                  <RelatedRecordsEditor
                    relation={rel}
                    targetEntity={te()}
                    existingRecords={existingRecords()}
                    isCreate={isCreate()}
                    onChange={(children) => handleRelationChange(rel.name, children)}
                    onWriteModeChange={(mode) => handleWriteModeChange(rel.name, mode)}
                  />
                )}
              </Show>
            );
          }}
        </For>
      </Show>

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
