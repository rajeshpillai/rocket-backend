import { For, Show, type JSX } from "solid-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Column<T = any> {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (value: any, row: T) => JSX.Element;
  class?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface DataTableProps<T = any> {
  columns: Column<T>[];
  rows: T[];
  sortField?: string;
  sortDir?: "ASC" | "DESC";
  onSort?: (field: string) => void;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
}

export function DataTable<T>(props: DataTableProps<T>) {
  const handleSort = (col: Column<T>) => {
    if (col.sortable && props.onSort) {
      props.onSort(col.key);
    }
  };

  const sortIndicator = (col: Column<T>) => {
    if (!col.sortable || props.sortField !== col.key) return "";
    return props.sortDir === "ASC" ? " ↑" : " ↓";
  };

  return (
    <table class="data-table">
      <thead class="table-header">
        <tr>
          <For each={props.columns}>
            {(col) => (
              <th
                class={col.sortable ? "table-header-sortable" : "table-header-cell"}
                onClick={() => handleSort(col)}
              >
                {col.header}
                {sortIndicator(col)}
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
                {props.emptyMessage ?? "No data found."}
              </td>
            </tr>
          }
        >
          <For each={props.rows}>
            {(row) => (
              <tr
                class={props.onRowClick ? "table-row-clickable" : "table-row"}
                onClick={() => props.onRowClick?.(row)}
              >
                <For each={props.columns}>
                  {(col) => (
                    <td class={col.class ?? "table-cell"}>
                      {col.render
                        ? col.render((row as Record<string, unknown>)[col.key], row)
                        : String((row as Record<string, unknown>)[col.key] ?? "")}
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </Show>
      </tbody>
    </table>
  );
}
