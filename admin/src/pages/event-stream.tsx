import { createSignal, onMount, onCleanup, type JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { listEvents } from "../api/events";
import type { EventRow } from "../types/event";
import { DataTable, type Column } from "../components/data-table";
import { Badge } from "../components/badge";
import { Pagination } from "../components/pagination";

const sourceColors: Record<string, "blue" | "green" | "red" | "gray" | "purple" | "yellow"> = {
  http: "blue",
  engine: "green",
  auth: "purple",
  webhook: "yellow",
  workflow: "blue",
  storage: "gray",
  db: "gray",
};

const statusColors: Record<string, "blue" | "green" | "red" | "gray" | "purple" | "yellow"> = {
  ok: "green",
  error: "red",
};

export function EventStream() {
  const navigate = useNavigate();

  const [events, setEvents] = createSignal<EventRow[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [page, setPage] = createSignal(1);
  const [perPage] = createSignal(25);
  const [total, setTotal] = createSignal(0);

  // Filters
  const [filterSource, setFilterSource] = createSignal("");
  const [filterEntity, setFilterEntity] = createSignal("");
  const [filterStatus, setFilterStatus] = createSignal("");
  const [filterTraceId, setFilterTraceId] = createSignal("");
  const [filterUserId, setFilterUserId] = createSignal("");
  const [filterFrom, setFilterFrom] = createSignal("");
  const [filterTo, setFilterTo] = createSignal("");

  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = createSignal(false);
  let intervalId: ReturnType<typeof setInterval> | undefined;

  async function loadEvents(p?: number) {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(p ?? page()),
        per_page: String(perPage()),
      };
      if (filterSource()) params.source = filterSource();
      if (filterEntity()) params.entity = filterEntity();
      if (filterStatus()) params.status = filterStatus();
      if (filterTraceId()) params.trace_id = filterTraceId();
      if (filterUserId()) params.user_id = filterUserId();
      if (filterFrom()) params.from = filterFrom();
      if (filterTo()) params.to = filterTo();

      const res = await listEvents(params);
      setEvents(res.data);
      setTotal(res.pagination.total);
    } finally {
      setLoading(false);
    }
  }

  function handleFilter() {
    setPage(1);
    loadEvents(1);
  }

  function handlePageChange(p: number) {
    setPage(p);
    loadEvents(p);
  }

  function toggleAutoRefresh(enabled: boolean) {
    setAutoRefresh(enabled);
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = undefined;
    }
    if (enabled) {
      intervalId = setInterval(() => {
        loadEvents();
      }, 5000);
    }
  }

  onMount(() => {
    loadEvents();
  });

  onCleanup(() => {
    if (intervalId) {
      clearInterval(intervalId);
    }
  });

  function formatDuration(val: number | null): string {
    if (val == null) return "-";
    return `${val.toFixed(2)}ms`;
  }

  const columns: Column<EventRow>[] = [
    {
      key: "source",
      header: "Source",
      render: (val): JSX.Element => (
        <Badge
          label={String(val)}
          color={sourceColors[String(val)] ?? "gray"}
        />
      ),
    },
    {
      key: "component",
      header: "Component",
      render: (val): JSX.Element => (
        <span class="text-sm">{String(val ?? "")}</span>
      ),
    },
    {
      key: "action",
      header: "Action",
      render: (val): JSX.Element => (
        <span class="text-sm font-mono">{String(val ?? "")}</span>
      ),
    },
    {
      key: "entity",
      header: "Entity",
      render: (val): JSX.Element => (
        <span class="text-sm">{val ? String(val) : "-"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (val): JSX.Element => (
        <Badge
          label={val ? String(val) : "-"}
          color={statusColors[String(val)] ?? "gray"}
        />
      ),
    },
    {
      key: "duration_ms",
      header: "Duration",
      render: (val): JSX.Element => (
        <span class="text-sm font-mono text-gray-500 dark:text-gray-400">
          {formatDuration(val as number | null)}
        </span>
      ),
    },
    {
      key: "created_at",
      header: "Created",
      render: (val): JSX.Element => {
        const d = new Date(String(val));
        return <span class="text-sm text-gray-500 dark:text-gray-400">{d.toLocaleString()}</span>;
      },
    },
  ];

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">Events</h1>
          <p class="page-subtitle">Activity feed with traces and spans</p>
        </div>
        <div class="flex items-center gap-3">
          <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={autoRefresh()}
              onChange={(e) => toggleAutoRefresh(e.currentTarget.checked)}
            />
            Auto-refresh
          </label>
          <button class="btn-secondary" onClick={() => loadEvents()}>
            Refresh
          </button>
        </div>
      </div>

      <div class="flex flex-wrap gap-4 mb-4">
        <div class="form-group" style={{ "min-width": "140px" }}>
          <label class="form-label">Source</label>
          <select
            class="form-input"
            value={filterSource()}
            onChange={(e) => setFilterSource(e.currentTarget.value)}
          >
            <option value="">All</option>
            <option value="http">http</option>
            <option value="engine">engine</option>
            <option value="auth">auth</option>
            <option value="webhook">webhook</option>
            <option value="workflow">workflow</option>
            <option value="storage">storage</option>
            <option value="db">db</option>
          </select>
        </div>
        <div class="form-group" style={{ "min-width": "140px" }}>
          <label class="form-label">Entity</label>
          <input
            type="text"
            class="form-input"
            value={filterEntity()}
            onInput={(e) => setFilterEntity(e.currentTarget.value)}
            placeholder="Filter by entity"
          />
        </div>
        <div class="form-group" style={{ "min-width": "120px" }}>
          <label class="form-label">Status</label>
          <select
            class="form-input"
            value={filterStatus()}
            onChange={(e) => setFilterStatus(e.currentTarget.value)}
          >
            <option value="">All</option>
            <option value="ok">ok</option>
            <option value="error">error</option>
          </select>
        </div>
        <div class="form-group" style={{ "min-width": "200px" }}>
          <label class="form-label">Trace ID</label>
          <input
            type="text"
            class="form-input"
            value={filterTraceId()}
            onInput={(e) => setFilterTraceId(e.currentTarget.value)}
            placeholder="Filter by trace ID"
          />
        </div>
        <div class="form-group" style={{ "min-width": "200px" }}>
          <label class="form-label">User ID</label>
          <input
            type="text"
            class="form-input"
            value={filterUserId()}
            onInput={(e) => setFilterUserId(e.currentTarget.value)}
            placeholder="Filter by user ID"
          />
        </div>
        <div class="form-group" style={{ "min-width": "160px" }}>
          <label class="form-label">From</label>
          <input
            type="datetime-local"
            class="form-input"
            value={filterFrom()}
            onInput={(e) => setFilterFrom(e.currentTarget.value)}
          />
        </div>
        <div class="form-group" style={{ "min-width": "160px" }}>
          <label class="form-label">To</label>
          <input
            type="datetime-local"
            class="form-input"
            value={filterTo()}
            onInput={(e) => setFilterTo(e.currentTarget.value)}
          />
        </div>
        <div class="form-group flex items-end">
          <button class="btn-primary" onClick={handleFilter}>
            Filter
          </button>
        </div>
      </div>

      {loading() ? (
        <p class="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={events()}
            emptyMessage="No events found. Events appear here when the system processes requests."
            onRowClick={(row) => navigate("/events/trace/" + row.trace_id)}
          />
          <Pagination
            page={page()}
            perPage={perPage()}
            total={total()}
            onPageChange={handlePageChange}
          />
        </>
      )}
    </div>
  );
}
