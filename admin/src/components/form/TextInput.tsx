import { Show } from "solid-js";

interface TextInputProps {
  label?: string;
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  type?: "text" | "number" | "datetime-local" | "date";
}

export function TextInput(props: TextInputProps) {
  return (
    <div class="form-group">
      <Show when={props.label}>
        <label class="form-label">{props.label}</label>
      </Show>
      <input
        type={props.type ?? "text"}
        class={`form-input ${props.error ? "form-input-error" : ""}`}
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        placeholder={props.placeholder}
        disabled={props.disabled}
      />
      <Show when={props.error}>
        <span class="form-error-text">{props.error}</span>
      </Show>
    </div>
  );
}
