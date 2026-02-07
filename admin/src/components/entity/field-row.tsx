import { Show } from "solid-js";
import type { Field, FieldType } from "../../types/entity";
import { FieldTypeSelector } from "./field-type-selector";
import { TagInput } from "../form/tag-input";

interface FieldRowProps {
  field: Field;
  isPrimaryKey: boolean;
  onChange: (field: Field) => void;
  onRemove: () => void;
}

export function FieldRow(props: FieldRowProps) {
  const update = (partial: Partial<Field>) => {
    props.onChange({ ...props.field, ...partial });
  };

  return (
    <tr class="table-row">
      <td class="table-cell">
        <input
          type="text"
          class="form-input"
          value={props.field.name}
          onInput={(e) => update({ name: e.currentTarget.value })}
          placeholder="field_name"
        />
      </td>
      <td class="table-cell">
        <FieldTypeSelector
          value={props.field.type}
          onChange={(type: FieldType) => update({ type })}
        />
      </td>
      <td class="table-cell text-center">
        <input
          type="checkbox"
          class="form-checkbox"
          checked={props.field.required ?? false}
          onChange={(e) => update({ required: e.currentTarget.checked })}
        />
      </td>
      <td class="table-cell text-center">
        <input
          type="checkbox"
          class="form-checkbox"
          checked={props.field.unique ?? false}
          onChange={(e) => update({ unique: e.currentTarget.checked })}
        />
      </td>
      <td class="table-cell">
        <input
          type="text"
          class="form-input"
          value={String(props.field.default ?? "")}
          onInput={(e) =>
            update({ default: e.currentTarget.value || undefined })
          }
          placeholder="default"
        />
      </td>
      <td class="table-cell">
        <Show when={props.field.type === "string"}>
          <TagInput
            tags={props.field.enum ?? []}
            onChange={(tags) => update({ enum: tags.length > 0 ? tags : undefined })}
            placeholder="enum value"
          />
        </Show>
      </td>
      <td class="table-cell-actions">
        <Show when={!props.isPrimaryKey}>
          <button class="btn-icon" onClick={() => props.onRemove()} title="Remove field">
            ✕
          </button>
        </Show>
      </td>
    </tr>
  );
}
