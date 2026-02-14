import { For, Show } from "solid-js";
import type { Field } from "../../types/entity";
import type { PermissionCondition } from "../../types/permission";

export interface ConditionBuilderProps {
  value: PermissionCondition[];
  onChange: (conditions: PermissionCondition[]) => void;
  fields?: Field[];
}

const OPERATORS = [
  { value: "eq", label: "equals (=)" },
  { value: "neq", label: "not equals (!=)" },
  { value: "gt", label: "greater than (>)" },
  { value: "gte", label: "greater or equal (>=)" },
  { value: "lt", label: "less than (<)" },
  { value: "lte", label: "less or equal (<=)" },
  { value: "in", label: "in (comma-separated)" },
  { value: "not_in", label: "not in (comma-separated)" },
];

export function ConditionBuilder(props: ConditionBuilderProps) {
  const updateCondition = (index: number, partial: Partial<PermissionCondition>) => {
    const updated = [...props.value];
    updated[index] = { ...updated[index], ...partial };
    props.onChange(updated);
  };

  const addCondition = () => {
    props.onChange([...props.value, { field: "", operator: "eq", value: "" }]);
  };

  const removeCondition = (index: number) => {
    props.onChange(props.value.filter((_, i) => i !== index));
  };

  return (
    <div class="cond-builder">
      <For each={props.value}>
        {(cond, i) => (
          <div class="cond-row">
            {/* Field name */}
            <div class="cond-field-wrap">
              <input
                type="text"
                class="form-input"
                list={`cond-fields-${i()}`}
                value={cond.field}
                onInput={(e) => updateCondition(i(), { field: e.currentTarget.value })}
                placeholder="field name"
              />
              <Show when={props.fields && props.fields.length > 0}>
                <datalist id={`cond-fields-${i()}`}>
                  <For each={props.fields!}>
                    {(f) => <option value={f.name}>{f.name}</option>}
                  </For>
                </datalist>
              </Show>
            </div>
            {/* Operator */}
            <select
              class="form-select cond-op-select"
              value={cond.operator}
              onChange={(e) => updateCondition(i(), { operator: e.currentTarget.value })}
            >
              <For each={OPERATORS}>
                {(op) => <option value={op.value}>{op.label}</option>}
              </For>
            </select>
            {/* Value */}
            <input
              type="text"
              class="form-input cond-value-input"
              value={String(cond.value ?? "")}
              onInput={(e) => {
                const v = e.currentTarget.value;
                // Try to preserve numeric types
                const num = Number(v);
                updateCondition(i(), { value: v === "" ? "" : (!isNaN(num) && v.trim() !== "" ? num : v) });
              }}
              placeholder={cond.operator === "in" || cond.operator === "not_in" ? "val1,val2,val3" : "value"}
            />
            <button class="btn-icon" onClick={() => removeCondition(i())} title="Remove">
              ✕
            </button>
          </div>
        )}
      </For>
      <div class="cond-actions">
        <button class="btn-secondary btn-sm" onClick={addCondition}>
          + Add Condition
        </button>
      </div>
      <Show when={props.value.length > 0}>
        <span class="text-xs text-gray-500 dark:text-gray-400">
          Use {"{{user.id}}"}, {"{{user.email}}"} for dynamic values
        </span>
      </Show>
    </div>
  );
}
