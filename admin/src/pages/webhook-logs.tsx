import { createSignal, onMount, type JSX } from "solid-js";
import { listWebhookLogs, retryWebhookLog } from "../api/webhooks";
import type { WebhookLogRow } from "../types/webhook";
import { isApiError } from "../types/api";
import { DataTable, type Column } from "../components/data-table";
import { Badge } from "../components/badge";
import { addToast } from "../stores/notifications";

const statusColors: Record<string, "green" | "blue" | "red" | "yellow" | "gray"> = {
  delivered: "green",
  retrying: "yellow",
  failed: "red",
  pending: "blue",
};

export function WebhookLogs() {
  const [logs, setLogs] = createSignal<WebhookLogRow[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [filterEntity, setFilterEntity] = createSignal("");
  const [filterStatus, setFilterStatus] = createSignal("");
  const [filterWebhookId, setFilterWebhookId] = createSignal("");

  async function loadLogs() {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filterEntity()) params.entity = filterEntity();
      if (filterStatus()) params.status = filterStatus();
      if (filterWebhookId()) params.webhook_id = filterWebhookId();
      const res = await listWebhookLogs(params);
      setLogs(res.data);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadLogs();
  });

  const handleRetry = async (id: string) => {
    try {
      await retryWebhookLog(id);
      addToast("success", "Webhook log queued for retry");
      await loadLogs();
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to retry webhook");
      }
    }
  };

  const columns: Column<WebhookLogRow>[] = [
    {
      key: "status",
      header: "Status",
      render: (val): JSX.Element => (
        <Badge
          label={String(val)}
          color={statusColors[String(val)] ?? "gray"}
        />
      ),
    },
    { key: "entity", header: "Entity" },
    {
      key: "hook",
      header: "Hook",
      render: (val): JSX.Element => (
        <span class="text-sm">{String(val)}</span>
      ),
    },
    {
      key: "method",
      header: "Method",
      render: (val): JSX.Element => (
        <Badge label={String(val)} color="blue" />
      ),
    },
    {
      key: "url",
      header: "URL",
      render: (val): JSX.Element => (
        <span class="text-sm font-mono truncate max-w-xs block" title={String(val)}>
          {String(val)}
        </span>
      ),
    },
    {
      key: "response_status",
      header: "HTTP",
      render: (val): JSX.Element => {
        const code = Number(val);
        const color = code >= 200 && code < 300 ? "green" : code > 0 ? "red" : "gray";
        return <Badge label={code > 0 ? String(code) : "---"} color={color} />;
      },
    },
    {
      key: "attempt",
      header: "Attempt",
      render: (val, row): JSX.Element => (
        <span class="text-sm">{String(val)}/{String(row.max_attempts)}</span>
      ),
    },
    {
      key: "error",
      header: "Error",
      render: (val): JSX.Element => (
        <span class="text-sm text-red-600 dark:text-red-400 truncate max-w-xs block" title={String(val)}>
          {val ? String(val) : ""}
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
    {
      key: "_actions",
      header: "",
      class: "table-cell-actions",
      render: (_, row): JSX.Element => (
        <div class="flex items-center justify-end gap-2">
          {(row.status === "failed" || row.status === "retrying") && (
            <button
              class="btn-secondary btn-sm"
              onClick={(e: Event) => {
                e.stopPropagation();
                handleRetry(row.id);
              }}
            >
              Retry
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">Webhook Logs</h1>
          <p class="page-subtitle">View webhook delivery history and retry failed deliveries</p>
        </div>
        <button class="btn-secondary" onClick={loadLogs}>
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
          <label class="form-label">Status</label>
          <select
            class="form-input"
            value={filterStatus()}
            onChange={(e) => setFilterStatus(e.currentTarget.value)}
          >
            <option value="">All</option>
            <option value="delivered">delivered</option>
            <option value="retrying">retrying</option>
            <option value="failed">failed</option>
            <option value="pending">pending</option>
          </select>
        </div>
        <div class="form-group" style={{ "min-width": "200px" }}>
          <label class="form-label">Webhook ID</label>
          <input
            type="text"
            class="form-input"
            value={filterWebhookId()}
            onInput={(e) => setFilterWebhookId(e.currentTarget.value)}
            placeholder="Filter by webhook ID"
          />
        </div>
        <div class="form-group flex items-end">
          <button class="btn-primary" onClick={loadLogs}>
            Filter
          </button>
        </div>
      </div>

      {loading() ? (
        <p class="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={logs()}
          emptyMessage="No webhook logs found. Logs appear here when webhooks are triggered."
        />
      )}
    </div>
  );
}
