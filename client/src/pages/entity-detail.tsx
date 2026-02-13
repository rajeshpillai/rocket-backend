import { createSignal, createEffect, Show, For } from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import {
  getRecord,
  updateRecord,
  deleteRecord,
  getEntity,
  listRelations,
} from "../api/data";
import {
  parseDefinition,
  parseRelationDefinition,
  type EntityDefinition,
  type RelationDefinition,
  type RelationRow,
} from "../types/entity";
import { addToast } from "../stores/notifications";
import { isApiError } from "../types/api";
import RecordForm, { type FkFieldInfo } from "../components/record-form";
import DataTable, { type Column } from "../components/data-table";
import ConfirmDialog from "../components/confirm-dialog";

export default function EntityDetailPage() {
  const params = useParams();
  const navigate = useNavigate();

  const [entityDef, setEntityDef] = createSignal<EntityDefinition | null>(null);
  const [relations, setRelations] = createSignal<RelationDefinition[]>([]);
  const [record, setRecord] = createSignal<Record<string, unknown>>({});
  const [relatedData, setRelatedData] = createSignal<
    Record<string, Record<string, unknown>[]>
  >({});
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [fieldErrors, setFieldErrors] = createSignal<Record<string, string>>(
    {}
  );
  const [activeTab, setActiveTab] = createSignal("details");
  const [showDelete, setShowDelete] = createSignal(false);
  const [fkFields, setFkFields] = createSignal<FkFieldInfo[]>([]);

  createEffect(() => {
    const entityName = params.entity;
    const id = params.id;
    if (entityName && id) {
      loadAll(entityName, id);
    }
  });

  async function loadAll(entityName: string, id: string) {
    setLoading(true);
    try {
      const entityRow = await getEntity(entityName);
      const def = parseDefinition(entityRow);
      setEntityDef(def);

      // Use row-level source field for filtering (not parsed definition)
      const rels = (await listRelations()) as RelationRow[];
      const matching = rels.filter((r) => r.source === entityName);
      const parsed = matching.map(parseRelationDefinition);
      setRelations(parsed);

      // Build FK field info: relations where this entity is the TARGET
      const fks: FkFieldInfo[] = [];
      for (const rel of rels) {
        if (rel.target === entityName) {
          const relDef = parseRelationDefinition(rel);
          if (relDef.target_key) {
            fks.push({
              fieldName: relDef.target_key,
              targetEntity: rel.source,
              targetKey: relDef.source_key || "id",
            });
          }
        }
      }
      setFkFields(fks);

      // Try to load record with includes; fall back to without if it fails
      const includeStr = matching.map((r) => r.name).join(",");
      let rec: Record<string, unknown>;
      try {
        rec = await getRecord(entityName, id, includeStr || undefined);
      } catch {
        // Include failed (e.g. unknown relation) — load without includes
        rec = await getRecord(entityName, id);
      }
      setRecord(rec);

      // Extract related data from the record
      const rd: Record<string, Record<string, unknown>[]> = {};
      for (const rel of parsed) {
        const relData = rec[rel.name];
        if (Array.isArray(relData)) {
          rd[rel.name] = relData as Record<string, unknown>[];
        } else if (relData && typeof relData === "object" && !Array.isArray(relData)) {
          rd[rel.name] = [relData as Record<string, unknown>];
        }
      }
      setRelatedData(rd);
    } catch {
      addToast("error", "Failed to load record");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    const def = entityDef();
    if (!def) return;

    setSaving(true);
    setFieldErrors({});

    try {
      const data = { ...record() };
      const id = String(data[def.primary_key.field]);

      // Clean up non-editable fields
      delete data[def.primary_key.field];
      delete data["created_at"];
      delete data["updated_at"];
      delete data["deleted_at"];
      for (const rel of relations()) {
        delete data[rel.name];
      }

      const updated = await updateRecord(def.name, id, data);
      setRecord({ ...updated, ...relatedData() });
      addToast("success", "Record saved");
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
        if (err.error.details) {
          const errs: Record<string, string> = {};
          for (const d of err.error.details) {
            if (d.field) errs[d.field] = d.message;
          }
          setFieldErrors(errs);
        }
      } else {
        addToast("error", "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const def = entityDef();
    if (!def) return;

    const id = String(record()[def.primary_key.field]);
    try {
      await deleteRecord(def.name, id);
      addToast("success", "Record deleted");
      navigate(`/data/${def.name}`);
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Delete failed");
      }
    }
  }

  function getRelatedColumns(
    relName: string
  ): Column<Record<string, unknown>>[] {
    const data = relatedData()[relName];
    if (!data || data.length === 0) return [];

    const keys = Object.keys(data[0]).filter(
      (k) => k !== "deleted_at" && !Array.isArray(data[0][k])
    );
    return keys.slice(0, 6).map((k) => ({
      key: k,
      header: k,
      sortable: false,
    }));
  }

  function getRelTarget(relName: string): string {
    const rel = relations().find((r) => r.name === relName);
    return rel?.target || "";
  }

  return (
    <div>
      <Show when={loading()}>
        <div class="loading-spinner">
          <div class="spinner" />
        </div>
      </Show>

      <Show when={!loading() && entityDef()}>
        <div class="page-header">
          <div>
            <h1 class="page-title">
              {params.entity}
              <span style={{ color: "#9ca3af", "font-weight": "normal", "font-size": "16px", "margin-left": "8px" }}>
                #{String(record()[entityDef()!.primary_key.field] || "").slice(0, 8)}
              </span>
            </h1>
            <p class="page-subtitle">
              <button
                class="btn-ghost btn-sm"
                style={{ padding: "0", "font-size": "13px" }}
                onClick={() => navigate(`/data/${params.entity}`)}
              >
                Back to list
              </button>
            </p>
          </div>
          <div class="page-actions">
            <button
              class="btn-primary"
              onClick={handleSave}
              disabled={saving()}
            >
              {saving() ? "Saving..." : "Save"}
            </button>
            <button
              class="btn-danger btn-sm"
              onClick={() => setShowDelete(true)}
            >
              Delete
            </button>
          </div>
        </div>

        <Show when={relations().length > 0}>
          <div class="tabs">
            <button
              class={`tab ${activeTab() === "details" ? "tab-active" : ""}`}
              onClick={() => setActiveTab("details")}
            >
              Details
            </button>
            <For each={relations()}>
              {(rel) => (
                <button
                  class={`tab ${activeTab() === rel.name ? "tab-active" : ""}`}
                  onClick={() => setActiveTab(rel.name)}
                >
                  {rel.name}
                  <Show when={relatedData()[rel.name]}>
                    <span class="badge badge-gray" style={{ "margin-left": "6px" }}>
                      {relatedData()[rel.name]?.length || 0}
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>

        <Show when={activeTab() === "details"}>
          <div class="section">
            <RecordForm
              fields={entityDef()!.fields}
              values={record()}
              onChange={(field, value) =>
                setRecord({ ...record(), [field]: value })
              }
              errors={fieldErrors()}
              fkFields={fkFields()}
            />
          </div>

          <Show when={entityDef()}>
            <div class="section">
              <h3 class="section-title">Record Metadata</h3>
              <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "16px" }}>
                <div class="form-group">
                  <label class="form-label">ID</label>
                  <div class="form-input" style={{ "background-color": "#f9fafb", cursor: "default" }}>
                    {String(record()[entityDef()!.primary_key.field] || "—")}
                  </div>
                </div>
                <Show when={record()["created_at"]}>
                  <div class="form-group">
                    <label class="form-label">Created At</label>
                    <div class="form-input" style={{ "background-color": "#f9fafb", cursor: "default" }}>
                      {formatDate(String(record()["created_at"]))}
                    </div>
                  </div>
                </Show>
                <Show when={record()["updated_at"]}>
                  <div class="form-group">
                    <label class="form-label">Updated At</label>
                    <div class="form-input" style={{ "background-color": "#f9fafb", cursor: "default" }}>
                      {formatDate(String(record()["updated_at"]))}
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          </Show>
        </Show>

        <For each={relations()}>
          {(rel) => (
            <Show when={activeTab() === rel.name}>
              <div class="section">
                <h3 class="section-title">
                  {rel.name}
                  <span style={{ "font-weight": "normal", color: "#9ca3af", "font-size": "14px", "margin-left": "8px" }}>
                    ({rel.type.replace(/_/g, " ")})
                  </span>
                </h3>
                <Show
                  when={
                    relatedData()[rel.name] &&
                    relatedData()[rel.name].length > 0
                  }
                  fallback={
                    <div class="empty-state" style={{ "padding-top": "2rem", "padding-bottom": "2rem" }}>
                      <div class="empty-state-text">
                        No related {rel.name} records
                      </div>
                    </div>
                  }
                >
                  <DataTable
                    columns={getRelatedColumns(rel.name)}
                    rows={relatedData()[rel.name] || []}
                    onRowClick={(row) => {
                      const id = row["id"];
                      const target = getRelTarget(rel.name);
                      if (id && target) {
                        navigate(`/data/${target}/${id}`);
                      }
                    }}
                  />
                </Show>
              </div>
            </Show>
          )}
        </For>

        <ConfirmDialog
          open={showDelete()}
          title="Delete Record"
          message="Are you sure you want to delete this record? This action cannot be undone."
          onConfirm={handleDelete}
          onCancel={() => setShowDelete(false)}
        />
      </Show>
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}
