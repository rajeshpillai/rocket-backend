import { createSignal, onMount, Show, type JSX } from "solid-js";
import { getEventStats } from "../api/events";
import type { EventStats, SourceStats } from "../types/event";
import { DataTable, type Column } from "../components/data-table";
import { Badge } from "../components/badge";

const sourceColors: Record<string, "blue" | "green" | "red" | "gray" | "purple" | "yellow"> = {
  http: "blue",
  engine: "green",
  auth: "purple",
  webhook: "yellow",
  workflow: "blue",
  storage: "gray",
  db: "gray",
};

export function EventStatsPage() {
  const [stats, setStats] = createSignal<EventStats | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [filterEntity, setFilterEntity] = createSignal("");
  const [filterFrom, setFilterFrom] = createSignal("");
  const [filterTo, setFilterTo] = createSignal("");

  async function loadStats() {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filterEntity()) params.entity = filterEntity();
      if (filterFrom()) params.from = filterFrom();
      if (filterTo()) params.to = filterTo();
      const res = await getEventStats(params);
      setStats(res.data);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadStats();
  });

  const columns: Column<SourceStats>[] = [
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
      key: "count",
      header: "Count",
      render: (val): JSX.Element => (
        <span>{Number(val).toLocaleString()}</span>
      ),
    },
    {
      key: "avg_duration_ms",
      header: "Avg Duration",
      render: (val): JSX.Element => (
        <span>{val != null ? `${Number(val).toFixed(2)}ms` : "N/A"}</span>
      ),
    },
    {
      key: "p95_duration_ms",
      header: "P95 Duration",
      render: (val): JSX.Element => (
        <span>{val != null ? `${Number(val).toFixed(2)}ms` : "N/A"}</span>
      ),
    },
    {
      key: "error_count",
      header: "Error Count",
      render: (val): JSX.Element => {
        const count = Number(val);
        return (
          <span style={count > 0 ? { color: "red" } : {}}>{count}</span>
        );
      },
    },
  ];

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">Event Stats</h1>
          <p class="page-subtitle">Aggregate performance metrics</p>
        </div>
        <button class="btn-secondary" onClick={loadStats}>
          Refresh
        </button>
      </div>

      <div class="flex gap-4 mb-4">
        <div class="form-group" style={{ "min-width": "150px" }}>
          <label class="form-label">Entity</label>
          <input
            type="text"
            class="form-input"
            value={filterEntity()}
            onInput={(e) => setFilterEntity(e.currentTarget.value)}
            placeholder="Filter by entity"
          />
        </div>
        <div class="form-group" style={{ "min-width": "150px" }}>
          <label class="form-label">From</label>
          <input
            type="date"
            class="form-input"
            value={filterFrom()}
            onInput={(e) => setFilterFrom(e.currentTarget.value)}
          />
        </div>
        <div class="form-group" style={{ "min-width": "150px" }}>
          <label class="form-label">To</label>
          <input
            type="date"
            class="form-input"
            value={filterTo()}
            onInput={(e) => setFilterTo(e.currentTarget.value)}
          />
        </div>
        <div class="form-group flex items-end">
          <button class="btn-primary" onClick={loadStats}>
            Apply
          </button>
        </div>
      </div>

      <Show when={!loading()} fallback={<p class="text-sm text-gray-500 dark:text-gray-400">Loading...</p>}>
        <Show when={stats()}>
          {(s) => (
            <>
              <div
                class="stats-grid"
                style={{
                  display: "grid",
                  "grid-template-columns": "repeat(4, 1fr)",
                  gap: "1rem",
                  "margin-bottom": "1.5rem",
                }}
              >
                <div class="card" style={{ padding: "1.5rem" }}>
                  <div style={{ "font-size": "0.875rem", color: "#6b7280", "margin-bottom": "0.25rem" }}>
                    Total Events
                  </div>
                  <div style={{ "font-size": "1.5rem", "font-weight": "600" }}>
                    {s().total_events.toLocaleString()}
                  </div>
                </div>

                <div class="card" style={{ padding: "1.5rem" }}>
                  <div style={{ "font-size": "0.875rem", color: "#6b7280", "margin-bottom": "0.25rem" }}>
                    Avg Latency
                  </div>
                  <div style={{ "font-size": "1.5rem", "font-weight": "600" }}>
                    {s().avg_latency_ms != null ? `${s().avg_latency_ms!.toFixed(2)}ms` : "N/A"}
                  </div>
                </div>

                <div class="card" style={{ padding: "1.5rem" }}>
                  <div style={{ "font-size": "0.875rem", color: "#6b7280", "margin-bottom": "0.25rem" }}>
                    P95 Latency
                  </div>
                  <div style={{ "font-size": "1.5rem", "font-weight": "600" }}>
                    {s().p95_latency_ms != null ? `${s().p95_latency_ms!.toFixed(2)}ms` : "N/A"}
                  </div>
                </div>

                <div class="card" style={{ padding: "1.5rem" }}>
                  <div style={{ "font-size": "0.875rem", color: "#6b7280", "margin-bottom": "0.25rem" }}>
                    Error Rate
                  </div>
                  <div
                    style={{
                      "font-size": "1.5rem",
                      "font-weight": "600",
                      color: s().error_rate > 0.05 ? "red" : "green",
                    }}
                  >
                    {(s().error_rate * 100).toFixed(1)}%
                  </div>
                </div>
              </div>

              <h2 style={{ "font-size": "1.125rem", "font-weight": "600", "margin-bottom": "0.75rem" }}>
                By Source
              </h2>
              <DataTable
                columns={columns}
                rows={s().by_source ?? []}
                emptyMessage="No source breakdown data available."
              />
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
