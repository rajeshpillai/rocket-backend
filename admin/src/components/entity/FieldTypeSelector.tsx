import { For } from "solid-js";
import { FIELD_TYPES, type FieldType } from "../../types/entity";

interface FieldTypeSelectorProps {
  value: string;
  onChange: (type: FieldType) => void;
  disabled?: boolean;
}

export function FieldTypeSelector(props: FieldTypeSelectorProps) {
  return (
    <select
      class="form-select"
      value={props.value}
      onChange={(e) => props.onChange(e.currentTarget.value as FieldType)}
      disabled={props.disabled}
    >
      <For each={FIELD_TYPES}>
        {(t) => <option value={t}>{t}</option>}
      </For>
    </select>
  );
}
