import { For, Show } from "solid-js";

interface SelectInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
}

export function SelectInput(props: SelectInputProps) {
  return (
    <div class="form-group">
      <Show when={props.label}>
        <label class="form-label">{props.label}</label>
      </Show>
      <select
        class={`form-select ${props.error ? "form-input-error" : ""}`}
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value)}
        disabled={props.disabled}
      >
        <Show when={props.placeholder}>
          <option value="">{props.placeholder}</option>
        </Show>
        <For each={props.options}>
          {(opt) => <option value={opt.value}>{opt.label}</option>}
        </For>
      </select>
      <Show when={props.error}>
        <span class="form-error-text">{props.error}</span>
      </Show>
    </div>
  );
}
