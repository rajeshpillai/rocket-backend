import { Show, For } from "solid-js";

interface PaginationProps {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function Pagination(props: PaginationProps) {
  const totalPages = () => Math.max(1, Math.ceil(props.total / props.perPage));

  const pageNumbers = () => {
    const total = totalPages();
    const current = props.page;
    const pages: number[] = [];

    let start = Math.max(1, current - 2);
    const end = Math.min(total, start + 4);
    start = Math.max(1, end - 4);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  };

  return (
    <Show when={props.total > props.perPage}>
      <div class="pagination">
        <span class="pagination-info">
          {props.total} total
        </span>
        <button
          class="page-btn"
          disabled={props.page <= 1}
          onClick={() => props.onPageChange(props.page - 1)}
        >
          Prev
        </button>
        <For each={pageNumbers()}>
          {(num) => (
            <button
              class={num === props.page ? "page-btn-active" : "page-btn"}
              onClick={() => props.onPageChange(num)}
            >
              {num}
            </button>
          )}
        </For>
        <button
          class="page-btn"
          disabled={props.page >= totalPages()}
          onClick={() => props.onPageChange(props.page + 1)}
        >
          Next
        </button>
      </div>
    </Show>
  );
}
