import { createSignal, Show, For } from "solid-js";
import { Modal } from "./modal";
import type { EntityDefinition } from "../types/entity";
import { writableFields, inputType, coerceFieldValue } from "../utils/field-helpers";

interface BulkUpdateModalProps {
  open: boolean;
  onClose: () => void;
  entity: EntityDefinition;
  selectedCount: number;
  onConfirm: (field: string, value: unknown) => void;
}

export function BulkUpdateModal(props: BulkUpdateModalProps) {
  const [selectedField, setSelectedField] = createSignal("");
  const [fieldValue, setFieldValue] = createSignal("");

  const fields = () => writableFields(props.entity, false);
  const currentField = () => fields().find((f) => f.name === selectedField());

  const handleConfirm = () => {
    const field = currentField();
    if (!field) return;
    const coerced = coerceFieldValue(fieldValue(), field);
    props.onConfirm(field.name, coerced);
    setSelectedField("");
    setFieldValue("");
  };

  const handleClose = () => {
    setSelectedField("");
    setFieldValue("");
    props.onClose();
  };

  return (
    <Modal open={props.open} onClose={handleClose} title="Bulk Update">
      <div class="flex flex-col gap-4">
        <p class="text-sm text-gray-600 dark:text-gray-400">
          Update <strong>{props.selectedCount}</strong> selected record(s).
          Choose a field and the new value to apply.
        </p>

        <div class="form-group">
          <label class="form-label">Field</label>
          <select
            class="form-select"
            value={selectedField()}
            onChange={(e) => {
              setSelectedField(e.currentTarget.value);
              setFieldValue("");
            }}
          >
            <option value="">Select field...</option>
            <For each={fields()}>
              {(f) => (
                <option value={f.name}>
                  {f.name} ({f.type})
                </option>
              )}
            </For>
          </select>
        </div>

        <Show when={currentField()}>
          {(field) => (
            <div class="form-group">
              <label class="form-label">New Value</label>
              <Show
                when={field().type !== "boolean"}
                fallback={
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={fieldValue() === "true"}
                      onChange={(e) => setFieldValue(String(e.currentTarget.checked))}
                    />
                    <span class="text-sm text-gray-600 dark:text-gray-400">
                      {fieldValue() === "true" ? "true" : "false"}
                    </span>
                  </label>
                }
              >
                <Show
                  when={!field().enum || field().enum!.length === 0}
                  fallback={
                    <select
                      class="form-select"
                      value={fieldValue()}
                      onChange={(e) => setFieldValue(e.currentTarget.value)}
                    >
                      <option value="">-- select --</option>
                      <For each={field().enum!}>
                        {(opt) => <option value={opt}>{opt}</option>}
                      </For>
                    </select>
                  }
                >
                  <Show
                    when={field().type !== "text" && field().type !== "json"}
                    fallback={
                      <textarea
                        class="form-input"
                        rows={field().type === "json" ? 5 : 3}
                        value={fieldValue()}
                        onInput={(e) => setFieldValue(e.currentTarget.value)}
                      />
                    }
                  >
                    <input
                      type={inputType(field().type)}
                      class="form-input"
                      value={fieldValue()}
                      onInput={(e) => setFieldValue(e.currentTarget.value)}
                    />
                  </Show>
                </Show>
              </Show>
            </div>
          )}
        </Show>

        <div class="flex items-center justify-end gap-3 pt-2">
          <button class="btn-secondary" onClick={handleClose}>
            Cancel
          </button>
          <button
            class="btn-primary"
            onClick={handleConfirm}
            disabled={!selectedField()}
          >
            Apply to {props.selectedCount} record(s)
          </button>
        </div>
      </div>
    </Modal>
  );
}
