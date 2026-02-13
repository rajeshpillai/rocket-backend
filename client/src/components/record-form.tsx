import { For, Show } from "solid-js";
import { type Field, isEditableField } from "../types/entity";
import FileField from "./file-field";
import FkSelect from "./fk-select";

export interface FkFieldInfo {
  /** The FK field name on this entity (e.g. "author_id") */
  fieldName: string;
  /** The related entity to look up (e.g. "author") */
  targetEntity: string;
  /** The key on the related entity (e.g. "id") */
  targetKey: string;
}

interface RecordFormProps {
  fields: Field[];
  values: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
  errors?: Record<string, string>;
  isNew?: boolean;
  fkFields?: FkFieldInfo[];
}

export default function RecordForm(props: RecordFormProps) {
  const editableFields = () =>
    props.fields.filter((f) => {
      if (!isEditableField(f)) return false;
      if (!props.isNew && f.name === "id") return false;
      return true;
    });

  function getFieldValue(name: string): unknown {
    return props.values[name] ?? "";
  }

  function handleChange(field: string, value: unknown) {
    props.onChange(field, value);
  }

  function getFkInfo(fieldName: string): FkFieldInfo | undefined {
    return props.fkFields?.find((fk) => fk.fieldName === fieldName);
  }

  function renderField(field: Field) {
    const value = getFieldValue(field.name);
    const errorMsg = props.errors?.[field.name];
    const labelClass = field.required ? "form-label form-label-required" : "form-label";

    // Check if this field is a FK and should render as a dropdown
    const fkInfo = getFkInfo(field.name);
    if (fkInfo) {
      return (
        <FkSelect
          label={field.name}
          value={value}
          onChange={(v) => handleChange(field.name, v)}
          required={field.required}
          error={errorMsg}
          targetEntity={fkInfo.targetEntity}
          targetKey={fkInfo.targetKey}
        />
      );
    }

    switch (field.type) {
      case "boolean":
        return (
          <div class="form-group">
            <label class="form-checkbox-label">
              <input
                type="checkbox"
                class="form-checkbox"
                checked={Boolean(value)}
                onChange={(e) =>
                  handleChange(field.name, e.currentTarget.checked)
                }
              />
              <span>{field.name}</span>
            </label>
            <Show when={errorMsg}>
              <span class="form-error-text">{errorMsg}</span>
            </Show>
          </div>
        );

      case "text":
      case "json":
        return (
          <div class="form-group">
            <label class={labelClass}>{field.name}</label>
            <textarea
              class={`form-textarea ${errorMsg ? "form-input-error" : ""}`}
              value={
                field.type === "json" && typeof value === "object"
                  ? JSON.stringify(value, null, 2)
                  : String(value ?? "")
              }
              onInput={(e) => {
                const v = e.currentTarget.value;
                if (field.type === "json") {
                  try {
                    handleChange(field.name, JSON.parse(v));
                  } catch {
                    handleChange(field.name, v);
                  }
                } else {
                  handleChange(field.name, v);
                }
              }}
              rows={field.type === "json" ? 6 : 3}
            />
            <Show when={errorMsg}>
              <span class="form-error-text">{errorMsg}</span>
            </Show>
          </div>
        );

      case "int":
      case "bigint":
      case "decimal":
        return (
          <div class="form-group">
            <label class={labelClass}>{field.name}</label>
            <input
              type="number"
              class={`form-input ${errorMsg ? "form-input-error" : ""}`}
              value={value !== null && value !== undefined && value !== "" ? String(value) : ""}
              step={field.type === "decimal" ? "0.01" : "1"}
              onInput={(e) => {
                const v = e.currentTarget.value;
                if (v === "") {
                  handleChange(field.name, null);
                } else if (field.type === "decimal") {
                  handleChange(field.name, parseFloat(v));
                } else {
                  handleChange(field.name, parseInt(v, 10));
                }
              }}
            />
            <Show when={errorMsg}>
              <span class="form-error-text">{errorMsg}</span>
            </Show>
          </div>
        );

      case "date":
        return (
          <div class="form-group">
            <label class={labelClass}>{field.name}</label>
            <input
              type="date"
              class={`form-input ${errorMsg ? "form-input-error" : ""}`}
              value={String(value ?? "")}
              onInput={(e) => handleChange(field.name, e.currentTarget.value)}
            />
            <Show when={errorMsg}>
              <span class="form-error-text">{errorMsg}</span>
            </Show>
          </div>
        );

      case "timestamp":
        return (
          <div class="form-group">
            <label class={labelClass}>{field.name}</label>
            <input
              type="datetime-local"
              class={`form-input ${errorMsg ? "form-input-error" : ""}`}
              value={formatTimestampForInput(value)}
              onInput={(e) => handleChange(field.name, e.currentTarget.value)}
            />
            <Show when={errorMsg}>
              <span class="form-error-text">{errorMsg}</span>
            </Show>
          </div>
        );

      case "file":
        return (
          <FileField
            label={field.name}
            value={value}
            onChange={(v) => handleChange(field.name, v)}
            required={field.required}
            error={errorMsg}
          />
        );

      default:
        if (field.enum && field.enum.length > 0) {
          return (
            <div class="form-group">
              <label class={labelClass}>{field.name}</label>
              <select
                class={`form-select ${errorMsg ? "form-input-error" : ""}`}
                value={String(value ?? "")}
                onChange={(e) => handleChange(field.name, e.currentTarget.value)}
              >
                <option value="">Select...</option>
                <For each={field.enum}>
                  {(opt) => <option value={opt}>{opt}</option>}
                </For>
              </select>
              <Show when={errorMsg}>
                <span class="form-error-text">{errorMsg}</span>
              </Show>
            </div>
          );
        }

        return (
          <div class="form-group">
            <label class={labelClass}>{field.name}</label>
            <input
              type="text"
              class={`form-input ${errorMsg ? "form-input-error" : ""}`}
              value={String(value ?? "")}
              onInput={(e) => handleChange(field.name, e.currentTarget.value)}
            />
            <Show when={errorMsg}>
              <span class="form-error-text">{errorMsg}</span>
            </Show>
          </div>
        );
    }
  }

  return (
    <div class="login-form">
      <For each={editableFields()}>
        {(field) => renderField(field)}
      </For>
    </div>
  );
}

function formatTimestampForInput(value: unknown): string {
  if (!value) return "";
  const str = String(value);
  try {
    const d = new Date(str);
    if (isNaN(d.getTime())) return str;
    return d.toISOString().slice(0, 16);
  } catch {
    return str;
  }
}
