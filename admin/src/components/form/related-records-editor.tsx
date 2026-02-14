import { createSignal, createEffect, For, Show } from "solid-js";
import type { EntityDefinition } from "../../types/entity";
import type { RelationDefinition, WriteMode } from "../../types/relation";
import { WRITE_MODE_OPTIONS } from "../../types/relation";
import { writableFields, inputType, coerceFieldValue } from "../../utils/field-helpers";
import { Badge } from "../badge";

export interface ChildRecordState {
  _key: string;
  _status: "existing" | "new" | "deleted";
  _editing: boolean;
  data: Record<string, unknown>;
}

interface RelatedRecordsEditorProps {
  relation: RelationDefinition;
  targetEntity: EntityDefinition;
  existingRecords: Record<string, unknown>[];
  isCreate: boolean;
  onChange: (records: ChildRecordState[]) => void;
  onWriteModeChange: (mode: string) => void;
}

export function RelatedRecordsEditor(props: RelatedRecordsEditorProps) {
  const [rows, setRows] = createSignal<ChildRecordState[]>([]);
  const [writeMode, setWriteMode] = createSignal<string>(
    props.relation.write_mode ?? "diff",
  );

  // Fields to show in the child table (exclude FK to parent and auto fields)
  const childFields = () => {
    const fields = writableFields(props.targetEntity, true);
    return fields.filter((f) => f.name !== props.relation.target_key);
  };

  const targetPK = () => props.targetEntity.primary_key.field;

  // Initialize rows from existing records
  createEffect(() => {
    const existing = props.existingRecords;
    const pk = targetPK();
    const states: ChildRecordState[] = existing.map((rec) => ({
      _key: String(rec[pk] ?? crypto.randomUUID()),
      _status: "existing" as const,
      _editing: false,
      data: { ...rec },
    }));
    setRows(states);
    props.onChange(states);
  });

  const notifyChange = (updated: ChildRecordState[]) => {
    setRows(updated);
    props.onChange(updated);
  };

  const addRow = () => {
    const newRow: ChildRecordState = {
      _key: crypto.randomUUID(),
      _status: "new",
      _editing: true,
      data: {},
    };
    notifyChange([...rows(), newRow]);
  };

  const deleteRow = (key: string) => {
    const updated = rows().map((r) => {
      if (r._key !== key) return r;
      if (r._status === "new") return null; // Remove new rows entirely
      return { ...r, _status: "deleted" as const, _editing: false };
    }).filter(Boolean) as ChildRecordState[];
    notifyChange(updated);
  };

  const undoDelete = (key: string) => {
    const updated = rows().map((r) =>
      r._key === key ? { ...r, _status: "existing" as const } : r,
    );
    notifyChange(updated);
  };

  const toggleEdit = (key: string) => {
    const updated = rows().map((r) =>
      r._key === key ? { ...r, _editing: !r._editing } : r,
    );
    setRows(updated);
  };

  const updateField = (key: string, fieldName: string, value: unknown) => {
    const updated = rows().map((r) =>
      r._key === key
        ? { ...r, data: { ...r.data, [fieldName]: value } }
        : r,
    );
    notifyChange(updated);
  };

  const handleWriteModeChange = (mode: string) => {
    setWriteMode(mode);
    props.onWriteModeChange(mode);
  };

  const formatCellValue = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  };

  const activeRows = () => rows().filter((r) => r._status !== "deleted");
  const deletedRows = () => rows().filter((r) => r._status === "deleted");

  const typeColors: Record<string, "green" | "blue" | "purple"> = {
    one_to_one: "green",
    one_to_many: "blue",
    many_to_many: "purple",
  };

  return (
    <div class="rel-editor">
      <div class="rel-editor-header">
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">{props.relation.name}</h3>
          <Badge
            label={props.relation.type.replace(/_/g, " ")}
            color={typeColors[props.relation.type] ?? "gray"}
          />
          <span class="text-xs text-gray-400 dark:text-gray-500">
            → {props.relation.target}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-xs text-gray-500 dark:text-gray-400">Write mode:</label>
          <select
            class="form-select rel-editor-mode-select"
            value={writeMode()}
            onChange={(e) => handleWriteModeChange(e.currentTarget.value)}
          >
            <For each={WRITE_MODE_OPTIONS}>
              {(mode) => <option value={mode}>{mode}</option>}
            </For>
          </select>
        </div>
      </div>

      {/* Child records table */}
      <Show
        when={activeRows().length > 0 || deletedRows().length > 0}
        fallback={
          <p class="text-xs text-gray-400 dark:text-gray-500 py-2">
            No related records.
          </p>
        }
      >
        <div class="rel-editor-table-wrap">
          <table class="rel-editor-table">
            <thead>
              <tr>
                <For each={childFields()}>
                  {(f) => (
                    <th class="rel-editor-th">{f.name}</th>
                  )}
                </For>
                <th class="rel-editor-th rel-editor-th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {/* Active rows */}
              <For each={activeRows()}>
                {(row) => (
                  <Show
                    when={row._editing}
                    fallback={
                      <tr class={`rel-editor-tr ${row._status === "new" ? "rel-editor-tr-new" : ""}`}>
                        <For each={childFields()}>
                          {(f) => (
                            <td class="rel-editor-td">
                              <span class="text-sm truncate block max-w-xs" title={formatCellValue(row.data[f.name])}>
                                {formatCellValue(row.data[f.name]) || <span class="text-gray-300 dark:text-gray-600">null</span>}
                              </span>
                            </td>
                          )}
                        </For>
                        <td class="rel-editor-td rel-editor-td-actions">
                          <div class="flex items-center justify-end gap-1">
                            <button
                              class="btn-secondary btn-xs"
                              onClick={() => toggleEdit(row._key)}
                            >
                              Edit
                            </button>
                            <button
                              class="btn-danger btn-xs"
                              onClick={() => deleteRow(row._key)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    }
                  >
                    {/* Inline edit mode */}
                    <tr class={`rel-editor-tr rel-editor-tr-editing ${row._status === "new" ? "rel-editor-tr-new" : ""}`}>
                      <For each={childFields()}>
                        {(f) => (
                          <td class="rel-editor-td">
                            <InlineFieldInput
                              field={f}
                              value={row.data[f.name]}
                              onChange={(val) => updateField(row._key, f.name, val)}
                            />
                          </td>
                        )}
                      </For>
                      <td class="rel-editor-td rel-editor-td-actions">
                        <div class="flex items-center justify-end gap-1">
                          <button
                            class="btn-secondary btn-xs"
                            onClick={() => toggleEdit(row._key)}
                          >
                            Done
                          </button>
                          <Show when={row._status === "new"}>
                            <button
                              class="btn-danger btn-xs"
                              onClick={() => deleteRow(row._key)}
                            >
                              Remove
                            </button>
                          </Show>
                        </div>
                      </td>
                    </tr>
                  </Show>
                )}
              </For>
              {/* Deleted rows */}
              <For each={deletedRows()}>
                {(row) => (
                  <tr class="rel-editor-tr rel-editor-tr-deleted">
                    <For each={childFields()}>
                      {(f) => (
                        <td class="rel-editor-td">
                          <span class="text-sm line-through text-gray-400 dark:text-gray-500">
                            {formatCellValue(row.data[f.name])}
                          </span>
                        </td>
                      )}
                    </For>
                    <td class="rel-editor-td rel-editor-td-actions">
                      <button
                        class="btn-secondary btn-xs"
                        onClick={() => undoDelete(row._key)}
                      >
                        Undo
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      <div class="rel-editor-actions">
        <button class="btn-secondary btn-sm" onClick={addRow}>
          + Add {props.relation.type === "one_to_one" && activeRows().length > 0 ? "" : "Row"}
        </button>
      </div>
    </div>
  );
}

/** Compact inline field input for child record editing. */
function InlineFieldInput(props: {
  field: { name: string; type: string; enum?: string[] };
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  const strVal = () => {
    const v = props.value;
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };

  const handleInput = (raw: string) => {
    const val = coerceFieldValue(raw, props.field as any);
    props.onChange(val === undefined ? null : val);
  };

  if (props.field.type === "boolean") {
    return (
      <input
        type="checkbox"
        class="form-checkbox"
        checked={props.value === true || props.value === "true"}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
    );
  }

  if (props.field.enum && props.field.enum.length > 0) {
    return (
      <select
        class="form-select rel-editor-inline-input"
        value={strVal()}
        onChange={(e) => props.onChange(e.currentTarget.value || null)}
      >
        <option value="">--</option>
        <For each={props.field.enum}>
          {(opt) => <option value={opt}>{opt}</option>}
        </For>
      </select>
    );
  }

  if (props.field.type === "text" || props.field.type === "json") {
    return (
      <textarea
        class="form-input rel-editor-inline-input"
        rows={1}
        value={strVal()}
        onInput={(e) => handleInput(e.currentTarget.value)}
      />
    );
  }

  return (
    <input
      type={inputType(props.field.type)}
      class="form-input rel-editor-inline-input"
      value={strVal()}
      onInput={(e) => handleInput(e.currentTarget.value)}
    />
  );
}
