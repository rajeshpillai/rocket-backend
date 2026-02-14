import { For, Show } from "solid-js";
import { inputType, coerceFieldValue } from "../../utils/field-helpers";

export interface InlineFieldInputProps {
  field: { name: string; type: string; enum?: string[] };
  value: unknown;
  onChange: (val: unknown) => void;
  error?: string;
  disabled?: boolean;
}

/** Compact inline field input for table cell editing. */
export function InlineFieldInput(props: InlineFieldInputProps) {
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

  const inputClass = () =>
    `form-input rel-editor-inline-input${props.error ? " form-input-error" : ""}`;

  if (props.field.type === "boolean") {
    return (
      <div>
        <input
          type="checkbox"
          class="form-checkbox"
          checked={props.value === true || props.value === "true"}
          onChange={(e) => props.onChange(e.currentTarget.checked)}
          disabled={props.disabled}
        />
        <Show when={props.error}>
          <div class="form-error-text">{props.error}</div>
        </Show>
      </div>
    );
  }

  if (props.field.enum && props.field.enum.length > 0) {
    return (
      <div>
        <select
          class={`form-select rel-editor-inline-input${props.error ? " form-input-error" : ""}`}
          value={strVal()}
          onChange={(e) => props.onChange(e.currentTarget.value || null)}
          disabled={props.disabled}
        >
          <option value="">--</option>
          <For each={props.field.enum}>
            {(opt) => <option value={opt}>{opt}</option>}
          </For>
        </select>
        <Show when={props.error}>
          <div class="form-error-text">{props.error}</div>
        </Show>
      </div>
    );
  }

  if (props.field.type === "text" || props.field.type === "json") {
    return (
      <div>
        <textarea
          class={inputClass()}
          rows={1}
          value={strVal()}
          onInput={(e) => handleInput(e.currentTarget.value)}
          disabled={props.disabled}
        />
        <Show when={props.error}>
          <div class="form-error-text">{props.error}</div>
        </Show>
      </div>
    );
  }

  return (
    <div>
      <input
        type={inputType(props.field.type)}
        class={inputClass()}
        value={strVal()}
        onInput={(e) => handleInput(e.currentTarget.value)}
        disabled={props.disabled}
      />
      <Show when={props.error}>
        <div class="form-error-text">{props.error}</div>
      </Show>
    </div>
  );
}
