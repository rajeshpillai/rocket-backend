import { createSignal, createEffect, Show } from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import { listRecords, deleteRecord, getEntity, listRelations } from "../api/data";
import {
  parseDefinition,
  parseRelationDefinition,
  type EntityDefinition,
  type Field,
  type RelationRow,
} from "../types/entity";
import { addToast } from "../stores/notifications";
import { isApiError } from "../types/api";
import DataTable, { type Column } from "../components/data-table";
import Pagination from "../components/pagination";
import FilterBar, { type FilterParam } from "../components/filter-bar";
import ConfirmDialog from "../components/confirm-dialog";
import Modal from "../components/modal";
import RecordForm, { type FkFieldInfo } from "../components/record-form";
import { createRecord, updateRecord } from "../api/data";
import { getEntityUIConfig } from "../stores/ui-config";
import type { UIConfig } from "../types/ui-config";
import { getCustomPage } from "./custom/registry";

/** Pick a human-readable display field from an entity's fields */
function pickDisplayField(fields: Field[], pkField: string): string | null {
  const preferred = ["name", "title", "label", "display_name", "email", "username", "slug"];
  for (const name of preferred) {
    if (fields.some((f) => f.name === name)) return name;
  }
  const systemFields = new Set([pkField, "id", "created_at", "updated_at", "deleted_at"]);
  const stringField = fields.find(
    (f) => (f.type === "string" || f.type === "text") && !systemFields.has(f.name) && !f.auto
  );
  return stringField?.name || null;
}

/** Lookup map: FK field name → { id → display string } */
type FkLookupMap = Record<string, Record<string, string>>;

export default function EntityListPage() {
  const params = useParams();
  const navigate = useNavigate();

  const [entityDef, setEntityDef] = createSignal<EntityDefinition | null>(null);
  const [relationNames, setRelationNames] = createSignal<string[]>([]);
  const [fkFields, setFkFields] = createSignal<FkFieldInfo[]>([]);
  const [records, setRecords] = createSignal<Record<string, unknown>[]>([]);
  const [total, setTotal] = createSignal(0);
  const [page, setPage] = createSignal(1);
  const [perPage, setPerPage] = createSignal(25);
  const [sortField, setSortField] = createSignal("");
  const [sortDir, setSortDir] = createSignal<"ASC" | "DESC">("DESC");
  const [filters, setFilters] = createSignal<FilterParam[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [uiConfig, setUIConfig] = createSignal<UIConfig | null>(null);

  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingRecord, setEditingRecord] = createSignal<Record<string, unknown>>({});
  const [isNewRecord, setIsNewRecord] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [fieldErrors, setFieldErrors] = createSignal<Record<string, string>>({});

  const [deleteTarget, setDeleteTarget] = createSignal<string | null>(null);
  const [showFilters, setShowFilters] = createSignal(false);
  const [fkLookups, setFkLookups] = createSignal<FkLookupMap>({});

  createEffect(() => {
    const entityName = params.entity;
    if (entityName) {
      loadEntity(entityName);
    }
  });

  createEffect(() => {
    if (entityDef()) {
      fetchData();
    }
  });

  async function loadEntity(name: string) {
    setLoading(true);
    setRecords([]);
    setPage(1);
    setFilters([]);
    setSortField("");
    try {
      const row = await getEntity(name);
      setEntityDef(parseDefinition(row));

      // Load UI config for this entity
      const config = getEntityUIConfig(name);
      setUIConfig(config);

      // Apply config defaults
      if (config?.list?.per_page) {
        setPerPage(config.list.per_page);
      }
      if (config?.list?.default_sort) {
        const sort = config.list.default_sort;
        if (sort.startsWith("-")) {
          setSortField(sort.slice(1));
          setSortDir("DESC");
        } else {
          setSortField(sort);
          setSortDir("ASC");
        }
      }

      // Use row-level source field to find relations for this entity
      const rels = (await listRelations()) as RelationRow[];
      const matching = rels.filter((r) => r.source === name);
      setRelationNames(matching.map((r) => r.name));

      // Build FK field info: relations where this entity is the TARGET
      // (meaning this entity has a FK column pointing to another entity)
      const fks: FkFieldInfo[] = [];
      for (const rel of rels) {
        if (rel.target === name) {
          const def = parseRelationDefinition(rel);
          if (def.target_key) {
            fks.push({
              fieldName: def.target_key,
              targetEntity: rel.source,
              targetKey: def.source_key || "id",
            });
          }
        }
      }
      setFkFields(fks);

      // Pre-load FK display lookups for table columns
      loadFkLookups(fks);
    } catch {
      addToast("error", `Failed to load entity: ${name}`);
      setEntityDef(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadFkLookups(fks: FkFieldInfo[]) {
    if (fks.length === 0) return;

    const lookups: FkLookupMap = {};
    await Promise.all(
      fks.map(async (fk) => {
        try {
          const entityRow = await getEntity(fk.targetEntity);
          const def = parseDefinition(entityRow);
          const displayField = pickDisplayField(def.fields, def.primary_key.field);

          const res = await listRecords(fk.targetEntity, { per_page: 200 });
          const map: Record<string, string> = {};
          for (const row of res.data) {
            const pk = String(row[fk.targetKey] ?? row[def.primary_key.field] ?? "");
            map[pk] = displayField ? String(row[displayField] ?? pk) : pk;
          }
          lookups[fk.fieldName] = map;
        } catch {
          // Silently skip — column will show raw value
        }
      })
    );
    setFkLookups(lookups);
  }

  async function fetchData() {
    const def = entityDef();
    if (!def) return;

    setLoading(true);
    try {
      const filterMap: Record<string, string> = {};
      for (const f of filters()) {
        if (f.operator === "eq") {
          filterMap[`filter[${f.field}]`] = f.value;
        } else {
          filterMap[`filter[${f.field}.${f.operator}]`] = f.value;
        }
      }

      let sort = sortField();
      if (sort && sortDir() === "DESC") {
        sort = `-${sort}`;
      }

      // Don't include relations on list page — not needed for table display
      const res = await listRecords(def.name, {
        page: page(),
        per_page: perPage(),
        sort: sort || undefined,
        filters: filterMap,
      });

      setRecords(res.data);
      setTotal(res.meta?.total ?? res.data.length);
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to fetch records");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleSort(field: string) {
    if (sortField() === field) {
      setSortDir(sortDir() === "ASC" ? "DESC" : "ASC");
    } else {
      setSortField(field);
      setSortDir("ASC");
    }
    setPage(1);
    fetchData();
  }

  function handlePageChange(p: number) {
    setPage(p);
    fetchData();
  }

  function handlePerPageChange(pp: number) {
    setPerPage(pp);
    setPage(1);
    fetchData();
  }

  function handleApplyFilters(newFilters: FilterParam[]) {
    setFilters(newFilters);
    setPage(1);
    fetchData();
  }

  function handleCreate() {
    setEditingRecord({});
    setIsNewRecord(true);
    setFieldErrors({});
    setEditorOpen(true);
  }

  function handleEdit(row: Record<string, unknown>) {
    setEditingRecord({ ...row });
    setIsNewRecord(false);
    setFieldErrors({});
    setEditorOpen(true);
  }

  async function handleSave() {
    const def = entityDef();
    if (!def) return;

    setSaving(true);
    setFieldErrors({});

    try {
      const data = editingRecord();
      if (isNewRecord()) {
        await createRecord(def.name, data);
        addToast("success", "Record created");
      } else {
        const id = String(data[def.primary_key.field]);
        const payload = { ...data };
        delete payload[def.primary_key.field];
        delete payload["created_at"];
        delete payload["updated_at"];
        delete payload["deleted_at"];
        // Remove relation data from payload
        for (const name of relationNames()) {
          delete payload[name];
        }
        await updateRecord(def.name, id, payload);
        addToast("success", "Record updated");
      }
      setEditorOpen(false);
      fetchData();
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
    const id = deleteTarget();
    const def = entityDef();
    if (!id || !def) return;

    try {
      await deleteRecord(def.name, id);
      addToast("success", "Record deleted");
      setDeleteTarget(null);
      fetchData();
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Delete failed");
      }
    }
  }

  function getColumnLabel(fieldName: string): string {
    return uiConfig()?.form?.field_overrides?.[fieldName]?.label || fieldName;
  }

  function getColumns(): Column<Record<string, unknown>>[] {
    const def = entityDef();
    if (!def) return [];

    const config = uiConfig();
    const hiddenFields = new Set(config?.form?.hidden_fields ?? []);
    hiddenFields.add("deleted_at");

    let fieldNames: string[];
    if (config?.list?.columns && config.list.columns.length > 0) {
      // Use configured column list
      fieldNames = config.list.columns.filter((c) => !hiddenFields.has(c));
    } else {
      // Default: first 8 non-hidden, non-PK fields
      const pkField = def.primary_key.field;
      fieldNames = def.fields
        .filter((f) => !hiddenFields.has(f.name) && f.name !== pkField)
        .slice(0, 8)
        .map((f) => f.name);
    }

    // Build a set of FK field names for quick lookup
    const fkFieldSet = new Set(fkFields().map((fk) => fk.fieldName));
    const lookups = fkLookups();

    const cols: Column<Record<string, unknown>>[] = fieldNames.map((name) => {
      const col: Column<Record<string, unknown>> = {
        key: name,
        header: getColumnLabel(name),
        sortable: true,
      };

      // Add custom render for FK columns to show display name instead of UUID
      if (fkFieldSet.has(name) && lookups[name]) {
        const map = lookups[name];
        col.render = (val) => {
          if (val === null || val === undefined) return <>{"—"}</>;
          const id = String(val);
          const display = map[id];
          return <>{display || id}</>;
        };
      }

      return col;
    });

    cols.push({
      key: "_actions",
      header: "",
      render: (_val, row) => (
        <div class="table-cell-actions">
          <button
            class="btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              handleEdit(row);
            }}
          >
            Edit
          </button>
          <button
            class="btn-ghost btn-sm"
            style={{ color: "#ef4444" }}
            onClick={(e) => {
              e.stopPropagation();
              const pk = def.primary_key.field;
              setDeleteTarget(String(row[pk]));
            }}
          >
            Delete
          </button>
        </div>
      ),
    });

    return cols;
  }

  // Check for custom page component
  const CustomPage = () => params.entity ? getCustomPage(params.entity, "list") : null;

  return (
    <Show
      when={!CustomPage()}
      fallback={
        <Show when={CustomPage()}>
          {(Comp) => {
            const C = Comp();
            return <C />;
          }}
        </Show>
      }
    >
      <div>
        <div class="page-header">
          <div>
            <h1 class="page-title">
              {uiConfig()?.list?.title || params.entity}
            </h1>
            <Show when={entityDef()}>
              <p class="page-subtitle">
                {total()} records | {entityDef()!.fields.length} fields
                {entityDef()!.soft_delete ? " | soft delete" : ""}
              </p>
            </Show>
          </div>
          <div class="page-actions">
            <button
              class="btn-secondary btn-sm"
              onClick={() => setShowFilters(!showFilters())}
            >
              {showFilters() ? "Hide Filters" : "Filters"}
            </button>
            <button class="btn-secondary btn-sm" onClick={fetchData}>
              Refresh
            </button>
            <button class="btn-primary btn-sm" onClick={handleCreate}>
              + New Record
            </button>
          </div>
        </div>

        <Show when={showFilters() && entityDef()}>
          <FilterBar
            fields={entityDef()!.fields}
            filters={filters()}
            onApply={handleApplyFilters}
          />
        </Show>

        <Show when={loading()}>
          <div class="loading-spinner">
            <div class="spinner" />
          </div>
        </Show>

        <Show when={!loading() && entityDef()}>
          <DataTable
            columns={getColumns()}
            rows={records()}
            sortField={sortField()}
            sortDir={sortDir()}
            onSort={handleSort}
            onRowClick={(row) => {
              const def = entityDef()!;
              const slugField = (def as any).slug?.field;
              const id = (slugField && row[slugField]) || row[def.primary_key.field];
              navigate(`/data/${params.entity}/${id}`);
            }}
            emptyMessage={`No ${params.entity} records found`}
          />

          <Pagination
            page={page()}
            perPage={perPage()}
            total={total()}
            onPageChange={handlePageChange}
            onPerPageChange={handlePerPageChange}
          />
        </Show>

        <Modal
          open={editorOpen()}
          onClose={() => setEditorOpen(false)}
          title={isNewRecord() ? `New ${params.entity}` : `Edit ${params.entity}`}
          wide
        >
          <Show when={entityDef()}>
            <RecordForm
              fields={entityDef()!.fields}
              values={editingRecord()}
              onChange={(field, value) =>
                setEditingRecord({ ...editingRecord(), [field]: value })
              }
              errors={fieldErrors()}
              isNew={isNewRecord()}
              fkFields={fkFields()}
              formConfig={uiConfig()?.form}
              slugConfig={(entityDef() as any)?.slug}
            />
            <div class="form-actions">
              <button
                class="btn-primary"
                onClick={handleSave}
                disabled={saving()}
              >
                {saving() ? "Saving..." : isNewRecord() ? "Create" : "Save Changes"}
              </button>
              <button
                class="btn-secondary"
                onClick={() => setEditorOpen(false)}
              >
                Cancel
              </button>
            </div>
          </Show>
        </Modal>

        <ConfirmDialog
          open={deleteTarget() !== null}
          title="Delete Record"
          message="Are you sure you want to delete this record? This action cannot be undone."
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      </div>
    </Show>
  );
}
