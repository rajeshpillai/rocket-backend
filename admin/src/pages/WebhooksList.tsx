import { createSignal, onMount, type JSX } from "solid-js";
import {
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
} from "../api/webhooks";
import {
  parseHeaders,
  parseRetry,
  emptyWebhook,
  type WebhookRow,
  type WebhookPayload,
} from "../types/webhook";
import { isApiError } from "../types/api";
import { useEntities } from "../stores/entities";
import { DataTable, type Column } from "../components/DataTable";
import { Modal } from "../components/Modal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Badge } from "../components/Badge";
import { addToast } from "../stores/notifications";

const hookColors: Record<string, "green" | "blue" | "purple" | "red"> = {
  after_write: "green",
  before_write: "blue",
  after_delete: "red",
  before_delete: "purple",
};

const methodColors: Record<string, "green" | "blue" | "purple" | "red" | "yellow"> = {
  POST: "blue",
  PUT: "purple",
  PATCH: "yellow",
  GET: "green",
  DELETE: "red",
};

export function WebhooksList() {
  const { entityNames, load: loadEntities } = useEntities();
  const [webhooks, setWebhooks] = createSignal<WebhookRow[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingWH, setEditingWH] = createSignal<WebhookPayload>(emptyWebhook());
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [editorError, setEditorError] = createSignal<string | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<string | null>(null);
  const [headersJson, setHeadersJson] = createSignal("{}");

  async function loadList() {
    setLoading(true);
    try {
      const res = await listWebhooks();
      setWebhooks(res.data);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadList();
    loadEntities();
  });

  const openCreate = () => {
    setEditingWH(emptyWebhook());
    setEditingId(null);
    setEditorError(null);
    setHeadersJson("{}");
    setEditorOpen(true);
  };

  const openEdit = (row: WebhookRow) => {
    const headers = parseHeaders(row);
    const retry = parseRetry(row);
    setEditingWH({
      id: row.id,
      entity: row.entity,
      hook: row.hook,
      url: row.url,
      method: row.method,
      headers,
      condition: row.condition ?? "",
      async: row.async,
      retry,
      active: row.active,
    });
    setEditingId(row.id);
    setEditorError(null);
    setHeadersJson(JSON.stringify(headers, null, 2));
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const wh = editingWH();
    if (!wh.entity) {
      setEditorError("Entity is required");
      return;
    }
    if (!wh.url) {
      setEditorError("URL is required");
      return;
    }
    if (!wh.url.startsWith("http://") && !wh.url.startsWith("https://")) {
      setEditorError("URL must start with http:// or https://");
      return;
    }

    let headers: Record<string, string>;
    try {
      headers = JSON.parse(headersJson());
    } catch {
      setEditorError("Invalid JSON in headers");
      return;
    }

    const payload: WebhookPayload = {
      entity: wh.entity,
      hook: wh.hook,
      url: wh.url,
      method: wh.method,
      headers,
      condition: wh.condition,
      async: wh.async,
      retry: wh.retry,
      active: wh.active,
    };

    setSaving(true);
    setEditorError(null);

    try {
      if (editingId()) {
        await updateWebhook(editingId()!, payload);
        addToast("success", "Webhook updated");
      } else {
        await createWebhook(payload);
        addToast("success", "Webhook created");
      }
      setEditorOpen(false);
      await loadList();
    } catch (err) {
      if (isApiError(err)) {
        setEditorError(err.error.message);
      } else {
        setEditorError("Failed to save webhook");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const id = deleteTarget();
    if (!id) return;
    try {
      await deleteWebhook(id);
      addToast("success", "Webhook deleted");
      setDeleteTarget(null);
      await loadList();
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to delete webhook");
      }
      setDeleteTarget(null);
    }
  };

  const columns: Column<WebhookRow>[] = [
    { key: "entity", header: "Entity" },
    {
      key: "hook",
      header: "Hook",
      render: (val): JSX.Element => (
        <Badge
          label={String(val)}
          color={hookColors[String(val)] ?? "gray"}
        />
      ),
    },
    {
      key: "method",
      header: "Method",
      render: (val): JSX.Element => (
        <Badge
          label={String(val)}
          color={methodColors[String(val)] ?? "gray"}
        />
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
      key: "async",
      header: "Mode",
      render: (val): JSX.Element => (
        <Badge label={val ? "Async" : "Sync"} color={val ? "green" : "yellow"} />
      ),
    },
    {
      key: "active",
      header: "Active",
      render: (val): JSX.Element => (
        <Badge label={val ? "Yes" : "No"} color={val ? "green" : "gray"} />
      ),
    },
    {
      key: "_actions",
      header: "",
      class: "table-cell-actions",
      render: (_, row): JSX.Element => (
        <div class="flex items-center justify-end gap-2">
          <button
            class="btn-secondary btn-sm"
            onClick={(e: Event) => {
              e.stopPropagation();
              openEdit(row);
            }}
          >
            Edit
          </button>
          <button
            class="btn-danger btn-sm"
            onClick={(e: Event) => {
              e.stopPropagation();
              setDeleteTarget(row.id);
            }}
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">Webhooks</h1>
          <p class="page-subtitle">Manage HTTP callouts triggered by entity writes</p>
        </div>
        <button class="btn-primary" onClick={openCreate}>
          Create Webhook
        </button>
      </div>

      {loading() ? (
        <p class="text-sm text-gray-500">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={webhooks()}
          emptyMessage="No webhooks yet. Create one to trigger HTTP callouts on entity writes."
        />
      )}

      <Modal
        open={editorOpen()}
        onClose={() => setEditorOpen(false)}
        title={editingId() ? "Edit Webhook" : "Create Webhook"}
        wide
      >
        <div class="form-stack">
          {editorError() && (
            <div class="form-error">{editorError()}</div>
          )}

          <div class="form-group">
            <label class="form-label">Entity</label>
            <select
              class="form-input"
              value={editingWH().entity}
              onChange={(e) =>
                setEditingWH({ ...editingWH(), entity: e.currentTarget.value })
              }
            >
              <option value="">Select entity...</option>
              {entityNames().map((name) => (
                <option value={name}>{name}</option>
              ))}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Hook</label>
            <select
              class="form-input"
              value={editingWH().hook}
              onChange={(e) =>
                setEditingWH({ ...editingWH(), hook: e.currentTarget.value })
              }
            >
              <option value="after_write">after_write</option>
              <option value="before_write">before_write</option>
              <option value="after_delete">after_delete</option>
              <option value="before_delete">before_delete</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">URL</label>
            <input
              type="text"
              class="form-input"
              value={editingWH().url}
              onInput={(e) =>
                setEditingWH({ ...editingWH(), url: e.currentTarget.value })
              }
              placeholder="https://example.com/webhook"
            />
          </div>

          <div class="form-group">
            <label class="form-label">Method</label>
            <select
              class="form-input"
              value={editingWH().method}
              onChange={(e) =>
                setEditingWH({ ...editingWH(), method: e.currentTarget.value })
              }
            >
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="GET">GET</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Headers (JSON)</label>
            <textarea
              class="form-input font-mono"
              rows={3}
              value={headersJson()}
              onInput={(e) => setHeadersJson(e.currentTarget.value)}
              placeholder='{"Authorization": "Bearer {{env.WEBHOOK_TOKEN}}"}'
            />
          </div>

          <div class="form-group">
            <label class="form-label">Condition (expression, empty = always fire)</label>
            <input
              type="text"
              class="form-input font-mono"
              value={editingWH().condition}
              onInput={(e) =>
                setEditingWH({ ...editingWH(), condition: e.currentTarget.value })
              }
              placeholder='action == "update" && record.status == "paid"'
            />
          </div>

          <div class="flex gap-6">
            <div class="form-group">
              <label class="form-label flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editingWH().async}
                  onChange={(e) =>
                    setEditingWH({ ...editingWH(), async: e.currentTarget.checked })
                  }
                />
                Async (fire after commit, with retries)
              </label>
            </div>

            <div class="form-group">
              <label class="form-label flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editingWH().active}
                  onChange={(e) =>
                    setEditingWH({ ...editingWH(), active: e.currentTarget.checked })
                  }
                />
                Active
              </label>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Max Retry Attempts</label>
            <input
              type="number"
              class="form-input"
              value={editingWH().retry.max_attempts}
              onInput={(e) =>
                setEditingWH({
                  ...editingWH(),
                  retry: { ...editingWH().retry, max_attempts: parseInt(e.currentTarget.value) || 3 },
                })
              }
              min={1}
              max={10}
            />
          </div>

          <div class="flex justify-end gap-2 mt-4">
            <button
              class="btn-secondary"
              onClick={() => setEditorOpen(false)}
            >
              Cancel
            </button>
            <button
              class="btn-primary"
              onClick={handleSave}
              disabled={saving()}
            >
              {saving() ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget() !== null}
        title="Delete Webhook"
        message="Are you sure you want to delete this webhook? All associated delivery logs will also be deleted."
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
