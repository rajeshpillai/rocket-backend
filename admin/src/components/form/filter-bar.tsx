import { For } from "solid-js";
import type { Field } from "../../types/entity";
import type { FilterParam } from "../../api/data";

const OPERATORS = [
  { value: "eq", label: "=" },
  { value: "neq", label: "!=" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "like", label: "like" },
  { value: "in", label: "in" },
  { value: "not_in", label: "not in" },
];

interface FilterBarProps {
  fields: Field[];
  filters: FilterParam[];
  onChange: (filters: FilterParam[]) => void;
  onApply: () => void;
}

export function FilterBar(props: FilterBarProps) {
  const updateFilter = (index: number, key: keyof FilterParam, value: string) => {
    const updated = [...props.filters];
    updated[index] = { ...updated[index], [key]: value };
    props.onChange(updated);
  };

  const addFilter = () => {
    props.onChange([
      ...props.filters,
      { field: "", operator: "eq", value: "" },
    ]);
  };

  const removeFilter = (index: number) => {
    props.onChange(props.filters.filter((_, i) => i !== index));
  };

  return (
    <div class="flex flex-col gap-2 mb-4">
      <For each={props.filters}>
        {(filter, i) => (
          <div class="flex items-center gap-2">
            <select
              class="form-select"
              value={filter.field}
              onChange={(e) => updateFilter(i(), "field", e.currentTarget.value)}
            >
              <option value="">Field...</option>
              <For each={props.fields}>
                {(f) => <option value={f.name}>{f.name}</option>}
              </For>
            </select>
            <select
              class="form-select"
              style="max-width: 100px"
              value={filter.operator}
              onChange={(e) => updateFilter(i(), "operator", e.currentTarget.value)}
            >
              <For each={OPERATORS}>
                {(op) => <option value={op.value}>{op.label}</option>}
              </For>
            </select>
            <input
              type="text"
              class="form-input"
              value={filter.value}
              onInput={(e) => updateFilter(i(), "value", e.currentTarget.value)}
              placeholder="Value"
            />
            <button class="btn-icon" onClick={() => removeFilter(i())}>
              ✕
            </button>
          </div>
        )}
      </For>
      <div class="flex items-center gap-2">
        <button class="btn-secondary btn-sm" onClick={addFilter}>
          + Add Filter
        </button>
        <button class="btn-primary btn-sm" onClick={() => props.onApply()}>
          Apply
        </button>
        {props.filters.length > 0 && (
          <button
            class="btn-ghost btn-sm"
            onClick={() => {
              props.onChange([]);
              props.onApply();
            }}
          >
            Clear All
          </button>
        )}
      </div>
    </div>
  );
}
