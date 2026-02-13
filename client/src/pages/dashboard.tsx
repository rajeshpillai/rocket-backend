import { createSignal, onMount, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { listEntities, listRecords } from "../api/data";
import { selectedApp } from "../stores/app";
import { parseDefinition, type EntityDefinition } from "../types/entity";
import { addToast } from "../stores/notifications";

interface EntityStat {
  entity: EntityDefinition;
  count: number;
}

const CARD_COLORS = [
  "card-icon-blue",
  "card-icon-green",
  "card-icon-purple",
  "card-icon-yellow",
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = createSignal<EntityStat[]>([]);
  const [loading, setLoading] = createSignal(true);

  onMount(() => {
    loadStats();
  });

  async function loadStats() {
    setLoading(true);
    try {
      const rows = await listEntities();
      const entities = rows.map(parseDefinition);

      const results: EntityStat[] = [];
      for (const entity of entities) {
        try {
          const res = await listRecords(entity.name, { per_page: 1 });
          results.push({ entity, count: res.meta?.total ?? 0 });
        } catch {
          results.push({ entity, count: 0 });
        }
      }
      setStats(results);
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
          <h1 class="page-title">Dashboard</h1>
          <p class="page-subtitle">
            Overview of <strong>{selectedApp()}</strong>
          </p>
        </div>
        <button class="btn-secondary btn-sm" onClick={loadStats}>
          Refresh
        </button>
      </div>

      <Show when={loading()}>
        <div class="loading-spinner">
          <div class="spinner" />
        </div>
      </Show>

      <Show when={!loading()}>
        <Show
          when={stats().length > 0}
          fallback={
            <div class="section">
              <div class="empty-state">
                <svg class="empty-state-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd" />
                </svg>
                <div class="empty-state-title">No entities defined</div>
                <div class="empty-state-text">
                  This app has no entities yet. Use the admin UI to create some.
                </div>
              </div>
            </div>
          }
        >
          <div class="card-grid">
            <For each={stats()}>
              {(stat, i) => (
                <div
                  class="card card-clickable"
                  onClick={() => navigate(`/data/${stat.entity.name}`)}
                >
                  <div class="card-header">
                    <div>
                      <div class="card-title">{stat.entity.name}</div>
                      <div class="card-description">
                        {stat.entity.fields.length} fields
                        {stat.entity.soft_delete ? " | soft delete" : ""}
                      </div>
                    </div>
                    <div class={`card-icon ${CARD_COLORS[i() % CARD_COLORS.length]}`}>
                      <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: "20px", height: "20px" }}>
                        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                      </svg>
                    </div>
                  </div>
                  <div class="card-value">{stat.count}</div>
                  <div class="card-footer">
                    <span>records</span>
                    <span>Click to browse</span>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
