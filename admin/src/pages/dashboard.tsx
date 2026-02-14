import { createSignal, onMount, Show, For } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { listEntities } from "../api/entities";
import { listRecords } from "../api/data";
import { listRelations } from "../api/relations";
import { listRules } from "../api/rules";
import { listStateMachines } from "../api/state-machines";
import { listWorkflows, listPendingInstances } from "../api/workflows";
import { listUsers } from "../api/users";
import { listPermissions } from "../api/permissions";
import { listWebhooks, listWebhookLogs } from "../api/webhooks";
import { parseDefinition } from "../types/entity";
import { Badge } from "../components/badge";

interface EntityStat {
  name: string;
  fieldCount: number;
  recordCount: number;
}

export function Dashboard() {
  const navigate = useNavigate();

  // Top-level stats
  const [entityStats, setEntityStats] = createSignal<EntityStat[]>([]);
  const [relationCount, setRelationCount] = createSignal(0);
  const [ruleStats, setRuleStats] = createSignal({ total: 0, active: 0 });
  const [smStats, setSmStats] = createSignal({ total: 0, active: 0 });
  const [workflowStats, setWorkflowStats] = createSignal({ total: 0, active: 0 });
  const [pendingInstances, setPendingInstances] = createSignal(0);
  const [userStats, setUserStats] = createSignal({ total: 0, active: 0 });
  const [permissionCount, setPermissionCount] = createSignal(0);
  const [webhookStats, setWebhookStats] = createSignal({ total: 0, active: 0 });
  const [failedLogs, setFailedLogs] = createSignal(0);

  const [loading, setLoading] = createSignal(true);
  const [entityLoading, setEntityLoading] = createSignal(true);

  const totalRecords = () => entityStats().reduce((sum, e) => sum + e.recordCount, 0);

  const loadAll = async () => {
    setLoading(true);
    setEntityLoading(true);

    // Fire all metadata calls in parallel
    const [
      entitiesRes,
      relationsRes,
      rulesRes,
      smRes,
      workflowsRes,
      pendingRes,
      usersRes,
      permsRes,
      webhooksRes,
      failedLogsRes,
    ] = await Promise.allSettled([
      listEntities(),
      listRelations(),
      listRules(),
      listStateMachines(),
      listWorkflows(),
      listPendingInstances(),
      listUsers(),
      listPermissions(),
      listWebhooks(),
      listWebhookLogs({ status: "failed" }),
    ]);

    // Process results
    if (relationsRes.status === "fulfilled") {
      setRelationCount(relationsRes.value.data.length);
    }
    if (rulesRes.status === "fulfilled") {
      const rules = rulesRes.value.data;
      setRuleStats({ total: rules.length, active: rules.filter((r) => r.active).length });
    }
    if (smRes.status === "fulfilled") {
      const sms = smRes.value.data;
      setSmStats({ total: sms.length, active: sms.filter((s) => s.active).length });
    }
    if (workflowsRes.status === "fulfilled") {
      const wfs = workflowsRes.value.data;
      setWorkflowStats({ total: wfs.length, active: wfs.filter((w) => w.active).length });
    }
    if (pendingRes.status === "fulfilled") {
      setPendingInstances(pendingRes.value.data.length);
    }
    if (usersRes.status === "fulfilled") {
      const users = usersRes.value.data;
      setUserStats({ total: users.length, active: users.filter((u) => u.active).length });
    }
    if (permsRes.status === "fulfilled") {
      setPermissionCount(permsRes.value.data.length);
    }
    if (webhooksRes.status === "fulfilled") {
      const whs = webhooksRes.value.data;
      setWebhookStats({ total: whs.length, active: whs.filter((w) => w.active).length });
    }
    if (failedLogsRes.status === "fulfilled") {
      setFailedLogs(failedLogsRes.value.data.length);
    }

    setLoading(false);

    // Now fetch record counts per entity (depends on entities list)
    if (entitiesRes.status === "fulfilled") {
      const entities = entitiesRes.value.data;
      const stats: EntityStat[] = entities.map((row) => {
        const def = parseDefinition(row);
        return { name: row.name, fieldCount: def.fields.length, recordCount: 0 };
      });

      // Set entity stats immediately (with 0 record counts) then fetch counts
      setEntityStats(stats);
      setEntityLoading(false);

      // Fetch record counts in parallel
      const countPromises = stats.map(async (stat) => {
        try {
          const res = await listRecords(stat.name, { page: 1, perPage: 1 });
          return { name: stat.name, count: res.meta?.total ?? res.data.length };
        } catch {
          return { name: stat.name, count: 0 };
        }
      });

      const counts = await Promise.all(countPromises);
      setEntityStats((prev) =>
        prev.map((e) => {
          const found = counts.find((c) => c.name === e.name);
          return found ? { ...e, recordCount: found.count } : e;
        }),
      );
    } else {
      setEntityLoading(false);
    }
  };

  onMount(loadAll);

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">Overview</h1>
          <p class="page-subtitle">App health and configuration at a glance</p>
        </div>
        <button class="btn-secondary" onClick={loadAll} disabled={loading()}>
          {loading() ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* ── Top Stat Cards ────────────────────────── */}
      <div class="dashboard-stats">
        <div class="stat-card" onClick={() => navigate("/entities")}>
          <div class="stat-card-value">
            <Show when={!loading()} fallback={<span class="dashboard-loading">...</span>}>
              {entityStats().length}
            </Show>
          </div>
          <div class="stat-card-label">Entities</div>
        </div>

        <div class="stat-card" onClick={() => navigate("/data")}>
          <div class="stat-card-value">
            <Show when={!loading()} fallback={<span class="dashboard-loading">...</span>}>
              {totalRecords().toLocaleString()}
            </Show>
          </div>
          <div class="stat-card-label">Total Records</div>
        </div>

        <div class="stat-card" onClick={() => navigate("/relations")}>
          <div class="stat-card-value">
            <Show when={!loading()} fallback={<span class="dashboard-loading">...</span>}>
              {relationCount()}
            </Show>
          </div>
          <div class="stat-card-label">Relations</div>
        </div>

        <div class="stat-card" onClick={() => navigate("/users")}>
          <div class="stat-card-value">
            <Show when={!loading()} fallback={<span class="dashboard-loading">...</span>}>
              {userStats().total}
            </Show>
          </div>
          <div class="stat-card-label">Users</div>
          <Show when={!loading() && userStats().total > 0}>
            <div class="stat-card-sub">{userStats().active} active</div>
          </Show>
        </div>
      </div>

      {/* ── Entity Breakdown ──────────────────────── */}
      <div class="dashboard-section-full">
        <div class="dashboard-section-title">
          <span>Entities</span>
          <span class="dashboard-section-link" onClick={() => navigate("/entities")}>
            Manage
          </span>
        </div>
        <Show
          when={!entityLoading()}
          fallback={<p class="dashboard-loading">Loading entities...</p>}
        >
          <Show
            when={entityStats().length > 0}
            fallback={
              <p class="text-sm text-gray-400">No entities defined yet.</p>
            }
          >
            <div class="dashboard-list">
              <For each={entityStats()}>
                {(entity) => (
                  <div
                    class="dashboard-list-item"
                    onClick={() => navigate(`/data/${entity.name}`)}
                  >
                    <div>
                      <div class="dashboard-list-item-name">{entity.name}</div>
                      <div class="dashboard-list-item-meta">
                        {entity.fieldCount} fields
                      </div>
                    </div>
                    <div class="dashboard-list-item-value">
                      {entity.recordCount.toLocaleString()} records
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>

      {/* ── Business Logic + Integrations ──────────── */}
      <div class="dashboard-grid">
        <div class="dashboard-section">
          <div class="dashboard-section-title">
            <span>Business Logic</span>
          </div>
          <Show when={!loading()} fallback={<p class="dashboard-loading">Loading...</p>}>
            <div class="space-y-3">
              <div class="dashboard-metric">
                <span
                  class="dashboard-metric-label cursor-pointer hover:text-blue-600"
                  onClick={() => navigate("/rules")}
                >
                  Rules
                </span>
                <span class="dashboard-metric-value">
                  {ruleStats().active} <span class="text-gray-400 text-xs font-normal">/ {ruleStats().total}</span>
                </span>
              </div>
              <div class="dashboard-metric">
                <span
                  class="dashboard-metric-label cursor-pointer hover:text-blue-600"
                  onClick={() => navigate("/state-machines")}
                >
                  State Machines
                </span>
                <span class="dashboard-metric-value">
                  {smStats().active} <span class="text-gray-400 text-xs font-normal">/ {smStats().total}</span>
                </span>
              </div>
              <div class="dashboard-metric">
                <span
                  class="dashboard-metric-label cursor-pointer hover:text-blue-600"
                  onClick={() => navigate("/workflows")}
                >
                  Workflows
                </span>
                <span class="dashboard-metric-value">
                  {workflowStats().active} <span class="text-gray-400 text-xs font-normal">/ {workflowStats().total}</span>
                </span>
              </div>
              <div class="dashboard-metric">
                <span
                  class="dashboard-metric-label cursor-pointer hover:text-blue-600"
                  onClick={() => navigate("/workflow-monitor")}
                >
                  Pending Instances
                </span>
                <span class="dashboard-metric-value">
                  {pendingInstances()}
                  <Show when={pendingInstances() > 0}>
                    {" "}<Badge label="action needed" color="yellow" />
                  </Show>
                </span>
              </div>
            </div>
          </Show>
        </div>

        <div class="dashboard-section">
          <div class="dashboard-section-title">
            <span>Integrations & Security</span>
          </div>
          <Show when={!loading()} fallback={<p class="dashboard-loading">Loading...</p>}>
            <div class="space-y-3">
              <div class="dashboard-metric">
                <span
                  class="dashboard-metric-label cursor-pointer hover:text-blue-600"
                  onClick={() => navigate("/webhooks")}
                >
                  Webhooks
                </span>
                <span class="dashboard-metric-value">
                  {webhookStats().active} <span class="text-gray-400 text-xs font-normal">/ {webhookStats().total}</span>
                </span>
              </div>
              <div class="dashboard-metric">
                <span
                  class="dashboard-metric-label cursor-pointer hover:text-blue-600"
                  onClick={() => navigate("/webhook-logs")}
                >
                  Failed Deliveries
                </span>
                <span class="dashboard-metric-value">
                  {failedLogs()}
                  <Show when={failedLogs() > 0}>
                    {" "}<Badge label="needs attention" color="red" />
                  </Show>
                </span>
              </div>
              <div class="dashboard-metric">
                <span
                  class="dashboard-metric-label cursor-pointer hover:text-blue-600"
                  onClick={() => navigate("/permissions")}
                >
                  Permissions
                </span>
                <span class="dashboard-metric-value">{permissionCount()}</span>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
