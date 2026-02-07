import { Show } from "solid-js";

interface ToggleProps {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Toggle(props: ToggleProps) {
  return (
    <div class="form-group">
      <Show when={props.label}>
        <label class="form-label">{props.label}</label>
      </Show>
      <button
        type="button"
        class={props.checked ? "form-toggle form-toggle-on" : "form-toggle form-toggle-off"}
        onClick={() => !props.disabled && props.onChange(!props.checked)}
      >
        <span
          class={`form-toggle-knob ${props.checked ? "form-toggle-knob-on" : "form-toggle-knob-off"}`}
        />
      </button>
    </div>
  );
}
