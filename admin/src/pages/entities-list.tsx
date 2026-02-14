import { createSignal, onMount, Show, For, type JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useEntities } from "../stores/entities";
import { deleteEntity } from "../api/entities";
import { exportSchema, importSchema, type ImportResult } from "../api/schema";
import { parseDefinition, type EntityRow } from "../types/entity";
import { isApiError } from "../types/api";
import { DataTable, type Column } from "../components/data-table";
import { ConfirmDialog } from "../components/confirm-dialog";
import { Badge } from "../components/badge";
import { addToast } from "../stores/notifications";
import { OnboardingWizard } from "../components/onboarding/onboarding-wizard";
import { selectedApp } from "../stores/app";

const WIZARD_DISMISSED_KEY = (app: string) => `rocket_wizard_dismissed_${app}`;

export function EntitiesList() {
  const navigate = useNavigate();
  const { entities, loading, load } = useEntities();
  const [deleteTarget, setDeleteTarget] = createSignal<string | null>(null);
  const [importing, setImporting] = createSignal(false);
  const [exporting, setExporting] = createSignal(false);
  const [importResult, setImportResult] = createSignal<ImportResult | null>(null);
  const [wizardDismissed, setWizardDismissed] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;

  const isWizardDismissed = () => {
    if (wizardDismissed()) return true;
    const app = selectedApp();
    if (!app) return true;
    return localStorage.getItem(WIZARD_DISMISSED_KEY(app)) === "true";
  };

  const dismissWizard = () => {
    const app = selectedApp();
    if (app) localStorage.setItem(WIZARD_DISMISSED_KEY(app), "true");
    setWizardDismissed(true);
    load();
  };

  const showWizard = () =>
    !loading() && entities().length === 0 && !isWizardDismissed();

  onMount(() => load());

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await exportSchema();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `schema-export-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
      addToast("success", "Schema exported successfully");
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to export schema");
      }
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = "";

    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await importSchema(data);
      setImportResult(result);
      addToast("success", result.message);
      await load(); // reload entities list
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else if (err instanceof SyntaxError) {
        addToast("error", "Invalid JSON file");
      } else {
        addToast("error", "Failed to import schema");
      }
    } finally {
      setImporting(false);
    }
  };

  const rows = () =>
    entities().map((row) => {
      const def = parseDefinition(row);
      return {
        name: row.name,
        table_name: row.table_name,
        field_count: def.fields.length,
        soft_delete: def.soft_delete,
      };
    });

  const handleDelete = async () => {
    const name = deleteTarget();
    if (!name) return;
    try {
      await deleteEntity(name);
      addToast("success", `Entity "${name}" deleted`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to delete entity");
      }
      setDeleteTarget(null);
    }
  };

  type Row = { name: string; table_name: string; field_count: number; soft_delete: boolean };

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Name",
      render: (_, row): JSX.Element => (
        <span
          class="table-cell-link"
          onClick={(e: Event) => {
            e.stopPropagation();
            navigate(`/entities/${row.name}`);
          }}
        >
          {row.name}
        </span>
      ),
    },
    { key: "table_name", header: "Table", class: "table-cell-mono" },
    { key: "field_count", header: "Fields" },
    {
      key: "soft_delete",
      header: "Soft Delete",
      render: (val): JSX.Element => (
        <Badge label={val ? "Yes" : "No"} color={val ? "green" : "gray"} />
      ),
    },
    {
      key: "_actions",
      header: "",
      class: "table-cell-actions",
      render: (_, row): JSX.Element => (
        <button
          class="btn-danger btn-sm"
          onClick={(e: Event) => {
            e.stopPropagation();
            setDeleteTarget(row.name);
          }}
        >
          Delete
        </button>
      ),
    },
  ];

  return (
    <div>
      <Show
        when={showWizard()}
        fallback={
          <>
            <div class="page-header">
              <div>
                <h1 class="page-title">Entities</h1>
                <p class="page-subtitle">Manage your data entities and their fields</p>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button class="btn-secondary" onClick={handleExport} disabled={exporting()}>
                  {exporting() ? "Exporting..." : "Export Schema"}
                </button>
                <button class="btn-secondary" onClick={() => fileInput?.click()} disabled={importing()}>
                  {importing() ? "Importing..." : "Import Schema"}
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".json"
                  style={{ display: "none" }}
                  onChange={handleImportFile}
                />
                <button class="btn-primary" onClick={() => navigate("/entities/new")}>
                  Create Entity
                </button>
              </div>
            </div>

            <Show when={importing()}>
              <div class="card" style={{
                "margin-bottom": "1rem",
                display: "flex",
                "align-items": "center",
                gap: "0.75rem",
                padding: "1rem 1.25rem",
                "background-color": "var(--color-info-bg, #eff6ff)",
                "border": "1px solid var(--color-info-border, #bfdbfe)",
              }}>
                <svg
                  style={{ width: "1.25rem", height: "1.25rem", "flex-shrink": "0" }}
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <circle cx="12" cy="12" r="10" stroke="var(--color-primary, #3b82f6)" stroke-width="3" stroke-dasharray="31.4 31.4" stroke-linecap="round">
                    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" />
                  </circle>
                </svg>
                <span style={{ "font-size": "0.9rem", color: "var(--color-primary, #3b82f6)", "font-weight": "500" }}>
                  Importing schema... This may take a moment.
                </span>
              </div>
            </Show>

            <Show when={importResult()}>
              {(result) => (
                <div class="card" style={{ "margin-bottom": "1rem" }}>
                  <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "0.5rem" }}>
                    <h3 style={{ margin: "0", "font-size": "0.95rem" }}>Import Results</h3>
                    <button class="btn-sm btn-secondary" onClick={() => setImportResult(null)}>Dismiss</button>
                  </div>
                  <div style={{ display: "flex", gap: "1rem", "flex-wrap": "wrap", "margin-bottom": "0.5rem" }}>
                    <For each={Object.entries(result().summary)}>
                      {([key, count]) => (
                        <span class="badge badge-blue">{key}: {count}</span>
                      )}
                    </For>
                  </div>
                  <Show when={result().errors && result().errors!.length > 0}>
                    <div style={{ "margin-top": "0.5rem", "font-size": "0.85rem", color: "var(--color-danger, #dc2626)" }}>
                      <strong>Errors:</strong>
                      <ul style={{ margin: "0.25rem 0", "padding-left": "1.25rem" }}>
                        <For each={result().errors}>
                          {(err) => <li>{err}</li>}
                        </For>
                      </ul>
                    </div>
                  </Show>
                </div>
              )}
            </Show>

            {loading() ? (
              <p class="text-sm text-gray-500">Loading...</p>
            ) : (
              <DataTable
                columns={columns}
                rows={rows()}
                emptyMessage="No entities yet. Create one to get started."
              />
            )}

            <ConfirmDialog
              open={deleteTarget() !== null}
              title="Delete Entity"
              message={`Are you sure you want to delete "${deleteTarget()}"? This will drop the underlying database table.`}
              onConfirm={handleDelete}
              onCancel={() => setDeleteTarget(null)}
            />
          </>
        }
      >
        <OnboardingWizard onDismiss={dismissWizard} />
      </Show>
    </div>
  );
}
