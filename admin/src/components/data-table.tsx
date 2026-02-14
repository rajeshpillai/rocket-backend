import { For, Show, createEffect, type JSX } from "solid-js";

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
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  rowId?: (row: T) => string;
}

export function DataTable<T>(props: DataTableProps<T>) {
  const getId = (row: T): string => {
    if (props.rowId) return props.rowId(row);
    return String((row as Record<string, unknown>)["id"] ?? "");
  };

  const handleSort = (col: Column<T>) => {
    if (col.sortable && props.onSort) {
      props.onSort(col.key);
    }
  };

  const sortIndicator = (col: Column<T>) => {
    if (!col.sortable || props.sortField !== col.key) return "";
    return props.sortDir === "ASC" ? " ↑" : " ↓";
  };

  const toggleRow = (id: string, e: Event) => {
    e.stopPropagation();
    const next = new Set(props.selectedIds ?? []);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    props.onSelectionChange?.(next);
  };

  const totalCols = () => props.columns.length + (props.selectable ? 1 : 0);

  return (
    <table class="data-table">
      <thead class="table-header">
        <tr>
          <Show when={props.selectable}>
            <th class="table-header-checkbox">
              <input
                type="checkbox"
                ref={(el) => {
                  createEffect(() => {
                    const allIds = props.rows.map((r) => getId(r));
                    const count = allIds.filter((id) => props.selectedIds?.has(id)).length;
                    el.indeterminate = count > 0 && count < allIds.length;
                    el.checked = allIds.length > 0 && count === allIds.length;
                  });
                }}
                onChange={(e) => {
                  const allIds = props.rows.map((r) => getId(r));
                  const next = new Set(props.selectedIds ?? []);
                  if (e.currentTarget.checked) {
                    allIds.forEach((id) => next.add(id));
                  } else {
                    allIds.forEach((id) => next.delete(id));
                  }
                  props.onSelectionChange?.(next);
                }}
              />
            </th>
          </Show>
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
              <td class="table-empty" colSpan={totalCols()}>
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
                <Show when={props.selectable}>
                  <td class="table-cell-checkbox">
                    <input
                      type="checkbox"
                      checked={props.selectedIds?.has(getId(row)) ?? false}
                      onChange={(e) => toggleRow(getId(row), e)}
                      onClick={(e: Event) => e.stopPropagation()}
                    />
                  </td>
                </Show>
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
