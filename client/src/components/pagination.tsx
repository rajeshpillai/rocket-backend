import { Show } from "solid-js";

interface PaginationProps {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
}

export default function Pagination(props: PaginationProps) {
  const totalPages = () => Math.ceil(props.total / props.perPage) || 1;

  const startRecord = () => (props.page - 1) * props.perPage + 1;
  const endRecord = () => Math.min(props.page * props.perPage, props.total);

  return (
    <Show when={props.total > 0}>
      <div class="pagination">
        <div class="pagination-info">
          Showing {startRecord()}–{endRecord()} of {props.total}
        </div>

        <div class="pagination-controls">
          <button
            class="pagination-btn"
            disabled={props.page <= 1}
            onClick={() => props.onPageChange(1)}
          >
            First
          </button>
          <button
            class="pagination-btn"
            disabled={props.page <= 1}
            onClick={() => props.onPageChange(props.page - 1)}
          >
            Prev
          </button>

          <span class="pagination-info" style={{ margin: "0 8px" }}>
            Page {props.page} of {totalPages()}
          </span>

          <button
            class="pagination-btn"
            disabled={props.page >= totalPages()}
            onClick={() => props.onPageChange(props.page + 1)}
          >
            Next
          </button>
          <button
            class="pagination-btn"
            disabled={props.page >= totalPages()}
            onClick={() => props.onPageChange(totalPages())}
          >
            Last
          </button>
        </div>

        <div class="pagination-per-page">
          <span>Per page:</span>
          <select
            class="pagination-per-page-select"
            value={props.perPage}
            onChange={(e) =>
              props.onPerPageChange(Number(e.currentTarget.value))
            }
          >
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
      </div>
    </Show>
  );
}
