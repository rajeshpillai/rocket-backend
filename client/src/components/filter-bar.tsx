import { createSignal, For, Show } from "solid-js";
import type { Field } from "../types/entity";

export interface FilterParam {
  field: string;
  operator: string;
  value: string;
}

const OPERATORS = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "not equals" },
  { value: "gt", label: "greater than" },
  { value: "gte", label: ">= " },
  { value: "lt", label: "less than" },
  { value: "lte", label: "<=" },
  { value: "like", label: "contains" },
  { value: "in", label: "in (comma sep)" },
];

interface FilterBarProps {
  fields: Field[];
  filters: FilterParam[];
  onApply: (filters: FilterParam[]) => void;
}

export default function FilterBar(props: FilterBarProps) {
  const [rows, setRows] = createSignal<FilterParam[]>(
    props.filters.length > 0 ? [...props.filters] : []
  );

  function addRow() {
    const fieldName = props.fields.length > 0 ? props.fields[0].name : "";
    setRows([...rows(), { field: fieldName, operator: "eq", value: "" }]);
  }

  function updateRow(index: number, key: keyof FilterParam, value: string) {
    setRows(
      rows().map((r, i) => (i === index ? { ...r, [key]: value } : r))
    );
  }

  function removeRow(index: number) {
    setRows(rows().filter((_, i) => i !== index));
  }

  function handleApply() {
    const valid = rows().filter((r) => r.field && r.value);
    props.onApply(valid);
  }

  function handleClear() {
    setRows([]);
    props.onApply([]);
  }

  return (
    <div class="filter-bar">
      <div class="filter-bar-header">
        <span class="filter-bar-title">Filters</span>
        <div class="filter-bar-actions">
          <button class="btn-ghost btn-sm" onClick={addRow}>
            + Add Filter
          </button>
          <Show when={rows().length > 0}>
            <button class="btn-ghost btn-sm" onClick={handleClear}>
              Clear
            </button>
            <button class="btn-primary btn-sm" onClick={handleApply}>
              Apply
            </button>
          </Show>
        </div>
      </div>

      <Show when={rows().length > 0}>
        <div class="filter-rows">
          <For each={rows()}>
            {(row, i) => (
              <div class="filter-row">
                <select
                  class="filter-field-select"
                  value={row.field}
                  onChange={(e) =>
                    updateRow(i(), "field", e.currentTarget.value)
                  }
                >
                  <For each={props.fields}>
                    {(f) => <option value={f.name}>{f.name}</option>}
                  </For>
                </select>

                <select
                  class="filter-op-select"
                  value={row.operator}
                  onChange={(e) =>
                    updateRow(i(), "operator", e.currentTarget.value)
                  }
                >
                  <For each={OPERATORS}>
                    {(op) => <option value={op.value}>{op.label}</option>}
                  </For>
                </select>

                <input
                  type="text"
                  class="filter-value-input"
                  value={row.value}
                  placeholder="Value"
                  onInput={(e) =>
                    updateRow(i(), "value", e.currentTarget.value)
                  }
                  onKeyDown={(e) => e.key === "Enter" && handleApply()}
                />

                <button
                  class="filter-remove-btn"
                  onClick={() => removeRow(i())}
                  title="Remove filter"
                >
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    style={{ width: "16px", height: "16px" }}
                  >
                    <path
                      fill-rule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={rows().length === 0}>
        <div class="filter-empty">No filters applied</div>
      </Show>
    </div>
  );
}
