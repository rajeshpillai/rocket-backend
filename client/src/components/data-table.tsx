import { For, Show, type JSX } from "solid-js";

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (value: unknown, row: T) => JSX.Element;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  sortField?: string;
  sortDir?: "ASC" | "DESC";
  onSort?: (field: string) => void;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
}

export default function DataTable<T extends Record<string, unknown>>(
  props: DataTableProps<T>
) {
  function handleSort(field: string) {
    if (props.onSort) {
      props.onSort(field);
    }
  }

  function getValue(row: T, key: string): unknown {
    return row[key];
  }

  function renderSortIcon(field: string): JSX.Element {
    if (props.sortField !== field) {
      return (
        <span class="table-sort-icon">
          ↕
        </span>
      );
    }
    return (
      <span class="table-sort-icon table-sort-icon-active">
        {props.sortDir === "ASC" ? "↑" : "↓"}
      </span>
    );
  }

  return (
    <div class="data-table-wrapper">
      <table class="data-table">
        <thead class="table-header">
          <tr>
            <For each={props.columns}>
              {(col) => (
                <th
                  class={`table-header-cell ${col.sortable ? "table-header-sortable" : ""}`}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  {col.header}
                  <Show when={col.sortable}>{renderSortIcon(col.key)}</Show>
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody class="table-body">
          <Show
            when={props.rows.length > 0}
            fallback={
              <tr>
                <td class="table-empty" colSpan={props.columns.length}>
                  {props.emptyMessage || "No records found"}
                </td>
              </tr>
            }
          >
            <For each={props.rows}>
              {(row) => (
                <tr
                  class={`table-row ${props.onRowClick ? "table-row-clickable" : ""}`}
                  onClick={() => props.onRowClick?.(row)}
                >
                  <For each={props.columns}>
                    {(col) => (
                      <td class="table-cell">
                        {col.render
                          ? col.render(getValue(row, col.key), row)
                          : formatCellValue(getValue(row, col.key))}
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </Show>
        </tbody>
      </table>
    </div>
  );
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  const str = String(value);
  if (str.length > 80) return str.slice(0, 77) + "...";
  return str;
}
