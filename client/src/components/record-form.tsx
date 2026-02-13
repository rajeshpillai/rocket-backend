import { For, Show } from "solid-js";
import { type Field, isEditableField } from "../types/entity";
import type { FormConfig } from "../types/ui-config";
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
  formConfig?: FormConfig;
}

export default function RecordForm(props: RecordFormProps) {
  const editableFields = () =>
    props.fields.filter((f) => {
      if (!isEditableField(f)) return false;
      if (!props.isNew && f.name === "id") return false;
      // Hide fields specified in formConfig
      if (props.formConfig?.hidden_fields?.includes(f.name)) return false;
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

  function getFieldLabel(fieldName: string): string {
    return props.formConfig?.field_overrides?.[fieldName]?.label || fieldName;
  }

  function isFieldReadonly(fieldName: string): boolean {
    if (props.formConfig?.readonly_fields?.includes(fieldName)) return true;
    if (props.formConfig?.field_overrides?.[fieldName]?.readonly) return true;
    return false;
  }

  function getFieldHelp(fieldName: string): string | undefined {
    return props.formConfig?.field_overrides?.[fieldName]?.help;
  }

  function renderField(field: Field) {
    const value = getFieldValue(field.name);
    const errorMsg = props.errors?.[field.name];
    const label = getFieldLabel(field.name);
    const labelClass = field.required ? "form-label form-label-required" : "form-label";
    const readonly = isFieldReadonly(field.name);
    const helpText = getFieldHelp(field.name);

    // Check if this field is a FK and should render as a dropdown
    const fkInfo = getFkInfo(field.name);
    if (fkInfo) {
      return (
        <div class="form-group">
          <FkSelect
            label={label}
            value={value}
            onChange={(v) => handleChange(field.name, v)}
            required={field.required}
            error={errorMsg}
            targetEntity={fkInfo.targetEntity}
            targetKey={fkInfo.targetKey}
          />
          <Show when={helpText}>
            <span class="form-help-text">{helpText}</span>
          </Show>
        </div>
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
                disabled={readonly}
                onChange={(e) =>
                  handleChange(field.name, e.currentTarget.checked)
                }
              />
              <span>{label}</span>
            </label>
            <Show when={helpText}>
              <span class="form-help-text">{helpText}</span>
            </Show>
            <Show when={errorMsg}>
              <span class="form-error-text">{errorMsg}</span>
            </Show>
          </div>
        );

      case "text":
      case "json":
        return (
          <div class="form-group">
            <label class={labelClass}>{label}</label>
            <textarea
              class={`form-textarea ${errorMsg ? "form-input-error" : ""}`}
              value={
                field.type === "json" && typeof value === "object"
                  ? JSON.stringify(value, null, 2)
                  : String(value ?? "")
              }
              disabled={readonly}
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
              rows={props.formConfig?.field_overrides?.[field.name]?.rows ?? (field.type === "json" ? 6 : 3)}
            />
            <Show when={helpText}>
              <span class="form-help-text">{helpText}</span>
            </Show>
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
            <label class={labelClass}>{label}</label>
            <input
              type="number"
              class={`form-input ${errorMsg ? "form-input-error" : ""}`}
              value={value !== null && value !== undefined && value !== "" ? String(value) : ""}
              step={field.type === "decimal" ? "0.01" : "1"}
              disabled={readonly}
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
            <Show when={helpText}>
              <span class="form-help-text">{helpText}</span>
            </Show>
            <Show when={errorMsg}>
              <span class="form-error-text">{errorMsg}</span>
            </Show>
          </div>
        );

      case "date":
        return (
          <div class="form-group">
            <label class={labelClass}>{label}</label>
            <input
              type="date"
              class={`form-input ${errorMsg ? "form-input-error" : ""}`}
              value={String(value ?? "")}
              disabled={readonly}
              onInput={(e) => handleChange(field.name, e.currentTarget.value)}
            />
            <Show when={helpText}>
              <span class="form-help-text">{helpText}</span>
            </Show>
            <Show when={errorMsg}>
              <span class="form-error-text">{errorMsg}</span>
            </Show>
          </div>
        );

      case "timestamp":
        return (
          <div class="form-group">
            <label class={labelClass}>{label}</label>
            <input
              type="datetime-local"
              class={`form-input ${errorMsg ? "form-input-error" : ""}`}
              value={formatTimestampForInput(value)}
              disabled={readonly}
              onInput={(e) => handleChange(field.name, e.currentTarget.value)}
            />
            <Show when={helpText}>
              <span class="form-help-text">{helpText}</span>
            </Show>
            <Show when={errorMsg}>
              <span class="form-error-text">{errorMsg}</span>
            </Show>
          </div>
        );

      case "file":
        return (
          <div class="form-group">
            <FileField
              label={label}
              value={value}
              onChange={(v) => handleChange(field.name, v)}
              required={field.required}
              error={errorMsg}
            />
            <Show when={helpText}>
              <span class="form-help-text">{helpText}</span>
            </Show>
          </div>
        );

      default:
        if (field.enum && field.enum.length > 0) {
          return (
            <div class="form-group">
              <label class={labelClass}>{label}</label>
              <select
                class={`form-select ${errorMsg ? "form-input-error" : ""}`}
                value={String(value ?? "")}
                disabled={readonly}
                onChange={(e) => handleChange(field.name, e.currentTarget.value)}
              >
                <option value="">Select...</option>
                <For each={field.enum}>
                  {(opt) => <option value={opt}>{opt}</option>}
                </For>
              </select>
              <Show when={helpText}>
                <span class="form-help-text">{helpText}</span>
              </Show>
              <Show when={errorMsg}>
                <span class="form-error-text">{errorMsg}</span>
              </Show>
            </div>
          );
        }

        return (
          <div class="form-group">
            <label class={labelClass}>{label}</label>
            <input
              type="text"
              class={`form-input ${errorMsg ? "form-input-error" : ""}`}
              value={String(value ?? "")}
              disabled={readonly}
              onInput={(e) => handleChange(field.name, e.currentTarget.value)}
            />
            <Show when={helpText}>
              <span class="form-help-text">{helpText}</span>
            </Show>
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
