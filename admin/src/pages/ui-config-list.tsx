import { createSignal, onMount, type JSX } from "solid-js";
import {
  listUIConfigs,
  createUIConfig,
  updateUIConfig,
  deleteUIConfig,
} from "../api/ui-config";
import {
  parseConfig,
  emptyUIConfig,
  type UIConfigRow,
  type UIConfigPayload,
} from "../types/ui-config";
import { isApiError } from "../types/api";
import { useEntities } from "../stores/entities";
import { DataTable, type Column } from "../components/data-table";
import { Modal } from "../components/modal";
import { ConfirmDialog } from "../components/confirm-dialog";
import { Badge } from "../components/badge";
import { addToast } from "../stores/notifications";

interface ImportEntry {
  entity: string;
  scope?: string;
  config: Record<string, unknown>;
}

export function UIConfigList() {
  const { entityNames, load: loadEntities } = useEntities();
  const [configs, setConfigs] = createSignal<UIConfigRow[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingConfig, setEditingConfig] = createSignal<UIConfigPayload>(emptyUIConfig());
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [editorError, setEditorError] = createSignal<string | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<string | null>(null);
  const [configJson, setConfigJson] = createSignal("{}");
  const [importing, setImporting] = createSignal(false);

  let fileInput!: HTMLInputElement;

  async function loadConfigs() {
    setLoading(true);
    try {
      const res = await listUIConfigs();
      setConfigs(res.data);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadConfigs();
    loadEntities();
  });

  type Row = UIConfigRow & {
    sectionCount: number;
    hasListConfig: boolean;
    hasFormConfig: boolean;
    hasSidebar: boolean;
  };

  const rows = (): Row[] =>
    configs().map((row) => {
      const config = parseConfig(row);
      return {
        ...row,
        sectionCount: (config as any).detail?.sections?.length ?? 0,
        hasListConfig: !!(config as any).list,
        hasFormConfig: !!(config as any).form,
        hasSidebar: !!(config as any).sidebar,
      };
    });

  const openCreate = () => {
    setEditingConfig(emptyUIConfig());
    setEditingId(null);
    setEditorError(null);
    setConfigJson("{}");
    setEditorOpen(true);
  };

  const openEdit = (row: UIConfigRow) => {
    const config = parseConfig(row);
    setEditingConfig({
      entity: row.entity,
      scope: row.scope,
      config,
    });
    setEditingId(row.id);
    setEditorError(null);
    setConfigJson(JSON.stringify(config, null, 2));
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const cfg = editingConfig();
    if (!cfg.entity) {
      setEditorError("Entity is required");
      return;
    }

    let config;
    try {
      config = JSON.parse(configJson());
    } catch {
      setEditorError("Invalid JSON in config");
      return;
    }

    const payload: UIConfigPayload = {
      entity: cfg.entity,
      scope: cfg.scope || "default",
      config,
    };

    setSaving(true);
    setEditorError(null);

    try {
      if (editingId()) {
        await updateUIConfig(editingId()!, payload);
        addToast("success", "UI config updated");
      } else {
        await createUIConfig(payload);
        addToast("success", "UI config created");
      }
      setEditorOpen(false);
      await loadConfigs();
    } catch (err) {
      if (isApiError(err)) {
        setEditorError(err.error.message);
      } else {
        setEditorError("Failed to save UI config");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const id = deleteTarget();
    if (!id) return;
    try {
      await deleteUIConfig(id);
      addToast("success", "UI config deleted");
      setDeleteTarget(null);
      await loadConfigs();
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to delete UI config");
      }
      setDeleteTarget(null);
    }
  };

  const handleExport = () => {
    const exportData: ImportEntry[] = configs().map((row) => ({
      entity: row.entity,
      scope: row.scope,
      config: parseConfig(row),
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ui-configs.json";
    a.click();
    URL.revokeObjectURL(url);
    addToast("success", `Exported ${exportData.length} UI config(s)`);
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const text = await file.text();
      let entries: ImportEntry[];
      try {
        entries = JSON.parse(text);
      } catch {
        addToast("error", "Invalid JSON file");
        return;
      }

      if (!Array.isArray(entries)) {
        addToast("error", "Expected a JSON array of UI config entries");
        return;
      }

      // Build a set of existing entity+scope combos for dedup
      const existing = new Set(configs().map((c) => `${c.entity}::${c.scope}`));

      let created = 0;
      let skipped = 0;
      let failed = 0;

      for (const entry of entries) {
        if (!entry.entity || !entry.config) {
          failed++;
          continue;
        }
        const scope = entry.scope || "default";
        const key = `${entry.entity}::${scope}`;

        if (existing.has(key)) {
          skipped++;
          continue;
        }

        try {
          await createUIConfig({ entity: entry.entity, scope, config: entry.config });
          existing.add(key);
          created++;
        } catch {
          failed++;
        }
      }

      const parts: string[] = [];
      if (created > 0) parts.push(`${created} created`);
      if (skipped > 0) parts.push(`${skipped} skipped (already exist)`);
      if (failed > 0) parts.push(`${failed} failed`);
      addToast(failed > 0 ? "error" : "success", `Import: ${parts.join(", ")}`);
      await loadConfigs();
    } finally {
      setImporting(false);
      fileInput.value = "";
    }
  };

  const columns: Column<Row>[] = [
    { key: "entity", header: "Entity" },
    {
      key: "scope",
      header: "Scope",
      render: (val): JSX.Element => (
        <Badge label={String(val)} color="blue" />
      ),
    },
    {
      key: "hasListConfig",
      header: "List",
      render: (val): JSX.Element => (
        <span class="text-sm text-gray-500 dark:text-gray-400">
          {val ? "Configured" : "-"}
        </span>
      ),
    },
    {
      key: "sectionCount",
      header: "Detail Sections",
      render: (val): JSX.Element => (
        <span class="text-sm text-gray-500 dark:text-gray-400">
          {val === 0 ? "-" : `${val} section${val === 1 ? "" : "s"}`}
        </span>
      ),
    },
    {
      key: "hasFormConfig",
      header: "Form",
      render: (val): JSX.Element => (
        <span class="text-sm text-gray-500 dark:text-gray-400">
          {val ? "Configured" : "-"}
        </span>
      ),
    },
    {
      key: "hasSidebar",
      header: "Sidebar",
      render: (val): JSX.Element => (
        <span class="text-sm text-gray-500 dark:text-gray-400">
          {val ? "Configured" : "-"}
        </span>
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
          <h1 class="page-title">UI Configs</h1>
          <p class="page-subtitle">
            Customize how entities appear in the client app (columns, forms, sidebar grouping)
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="btn-secondary"
            onClick={handleExport}
            disabled={configs().length === 0}
          >
            Export
          </button>
          <button
            class="btn-secondary"
            onClick={() => fileInput.click()}
            disabled={importing()}
          >
            {importing() ? "Importing..." : "Import"}
          </button>
          <input
            ref={fileInput!}
            type="file"
            accept=".json"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) handleImport(file);
            }}
          />
          <button class="btn-primary" onClick={openCreate}>
            Create UI Config
          </button>
        </div>
      </div>

      {loading() ? (
        <p class="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={rows()}
          emptyMessage="No UI configs yet. Create one to customize entity display."
        />
      )}

      <Modal
        open={editorOpen()}
        onClose={() => setEditorOpen(false)}
        title={editingId() ? "Edit UI Config" : "Create UI Config"}
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
              value={editingConfig().entity}
              disabled={!!editingId()}
              onChange={(e) =>
                setEditingConfig({ ...editingConfig(), entity: e.currentTarget.value })
              }
            >
              <option value="">Select entity...</option>
              {entityNames().map((name) => (
                <option value={name}>{name}</option>
              ))}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Scope</label>
            <input
              type="text"
              class="form-input"
              value={editingConfig().scope}
              onInput={(e) =>
                setEditingConfig({ ...editingConfig(), scope: e.currentTarget.value })
              }
              placeholder="default"
            />
          </div>

          <div class="form-group">
            <label class="form-label">Config (JSON)</label>
            <textarea
              class="form-input font-mono"
              rows={16}
              value={configJson()}
              onInput={(e) => setConfigJson(e.currentTarget.value)}
              placeholder={JSON.stringify({
                list: { title: "My Entity", columns: ["name", "status", "created_at"], default_sort: "-created_at" },
                detail: { title: "Details", sections: [{ title: "Basic", fields: ["name", "status"] }] },
                form: { field_overrides: { name: { label: "Full Name" } }, hidden_fields: [], readonly_fields: [] },
                sidebar: { label: "My Entity", group: "Content" },
              }, null, 2)}
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
        title="Delete UI Config"
        message="Are you sure you want to delete this UI config? The client will revert to default display."
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
