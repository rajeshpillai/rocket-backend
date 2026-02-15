import { createSignal, createEffect, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { listRecords } from "../api/data";
import { selectedApp } from "../stores/app";
import { getEntityUIConfig, uiConfigsLoaded } from "../stores/ui-config";
import { addToast } from "../stores/notifications";
import type { DashboardConfig, DashboardWidget } from "../types/ui-config";

const COLOR_MAP: Record<string, string> = {
  blue: "card-icon-blue",
  green: "card-icon-green",
  purple: "card-icon-purple",
  yellow: "card-icon-yellow",
};

interface StatResult {
  widget: DashboardWidget;
  count: number;
}

interface RecentResult {
  widget: DashboardWidget;
  records: Record<string, unknown>[];
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = createSignal(true);
  const [stats, setStats] = createSignal<StatResult[]>([]);
  const [recents, setRecents] = createSignal<RecentResult[]>([]);
  const [config, setConfig] = createSignal<DashboardConfig | null>(null);

  // React to UI configs becoming available (loaded async by sidebar/layout)
  createEffect(() => {
    if (!uiConfigsLoaded()) return;
    const appConfig = getEntityUIConfig("_app");
    if (appConfig?.dashboard) {
      setConfig(appConfig.dashboard);
      loadData(appConfig.dashboard);
    } else {
      setLoading(false);
    }
  });

  async function loadData(cfg?: DashboardConfig | null) {
    const dashConfig = cfg ?? config();
    if (!dashConfig?.widgets?.length) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const statResults: StatResult[] = [];
      const recentResults: RecentResult[] = [];

      for (const widget of dashConfig.widgets) {
        try {
          const filters: Record<string, string> = {};
          if (widget.filter) {
            for (const [k, v] of Object.entries(widget.filter)) {
              filters[`filter[${k}]`] = String(v);
            }
          }

          if (widget.type === "stat") {
            const res = await listRecords(widget.entity, {
              per_page: 1,
              filters,
            });
            statResults.push({ widget, count: res.meta?.total ?? 0 });
          } else if (widget.type === "recent") {
            const res = await listRecords(widget.entity, {
              per_page: widget.limit ?? 5,
              sort: widget.sort ?? "-created_at",
              filters,
            });
            recentResults.push({ widget, records: res.data ?? [] });
          }
        } catch {
          if (widget.type === "stat") {
            statResults.push({ widget, count: 0 });
          } else {
            recentResults.push({ widget, records: [] });
          }
        }
      }

      setStats(statResults);
      setRecents(recentResults);
    } catch {
      addToast("error", "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">
            {config()?.title ?? `Welcome to ${selectedApp()}`}
          </h1>
          <Show when={config()?.subtitle}>
            <p class="page-subtitle">{config()!.subtitle}</p>
          </Show>
        </div>
        <Show when={config()?.widgets?.length}>
          <button class="btn-secondary btn-sm" onClick={() => loadData()}>
            Refresh
          </button>
        </Show>
      </div>

      <Show when={loading()}>
        <div class="loading-spinner">
          <div class="spinner" />
        </div>
      </Show>

      <Show when={!loading()}>
        <Show
          when={config()?.widgets?.length}
          fallback={
            <div class="section">
              <div class="empty-state">
                <svg class="empty-state-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                </svg>
                <div class="empty-state-title">Welcome to {selectedApp()}</div>
                <div class="empty-state-text">
                  Configure the dashboard via UI Configs (entity: <code>_app</code>) to add widgets here.
                </div>
              </div>
            </div>
          }
        >
          {/* Stat widgets */}
          <Show when={stats().length > 0}>
            <div class="card-grid">
              <For each={stats()}>
                {(stat) => (
                  <div
                    class="card card-clickable"
                    onClick={() => navigate(`/data/${stat.widget.entity}`)}
                  >
                    <div class="card-header">
                      <div class="card-title">{stat.widget.title}</div>
                      <div class={`card-icon ${COLOR_MAP[stat.widget.color ?? "blue"]}`}>
                        <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: "20px", height: "20px" }}>
                          <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                        </svg>
                      </div>
                    </div>
                    <div class="card-value">{stat.count}</div>
                    <div class="card-footer">
                      <span>{stat.widget.entity}</span>
                      <span>View all</span>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Recent record widgets */}
          <For each={recents()}>
            {(recent) => (
              <div class="section" style={{ "margin-top": "1.5rem" }}>
                <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "0.75rem" }}>
                  <h2 class="section-title" style={{ margin: 0 }}>{recent.widget.title}</h2>
                  <button
                    class="btn-secondary btn-sm"
                    onClick={() => navigate(`/data/${recent.widget.entity}`)}
                  >
                    View all
                  </button>
                </div>
                <Show
                  when={recent.records.length > 0}
                  fallback={
                    <div class="text-sm text-gray-500" style={{ padding: "1rem 0" }}>
                      No records found.
                    </div>
                  }
                >
                  <div class="overflow-x-auto">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <For each={recent.widget.columns ?? ["id"]}>
                            {(col) => <th>{col}</th>}
                          </For>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={recent.records}>
                          {(record) => (
                            <tr
                              class="cursor-pointer hover:bg-gray-50"
                              onClick={() =>
                                navigate(`/data/${recent.widget.entity}/${record.id}`)
                              }
                            >
                              <For each={recent.widget.columns ?? ["id"]}>
                                {(col) => (
                                  <td class="text-sm text-gray-700 truncate" style={{ "max-width": "200px" }}>
                                    {formatValue(record[col])}
                                  </td>
                                )}
                              </For>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
}

function formatValue(val: unknown): string {
  if (val == null) return "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (typeof val === "object") return JSON.stringify(val);
  const s = String(val);
  // Format ISO dates
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    return new Date(s).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  return s;
}
