import { createSignal, onMount, Show, createEffect, type JSX } from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import { useEntities } from "../stores/entities";
import { useRelations } from "../stores/relations";
import { parseDefinition, type EntityDefinition } from "../types/entity";
import {
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  type FilterParam,
} from "../api/data";
import { isApiError } from "../types/api";
import { DataTable, type Column } from "../components/data-table";
import { Pagination } from "../components/pagination";
import { Modal } from "../components/modal";
import { ConfirmDialog } from "../components/confirm-dialog";
import { FilterBar } from "../components/form/filter-bar";
import { DataRecordEditor } from "./data-record-editor";
import { CsvImport } from "../components/csv-import";
import { BulkActionBar } from "../components/bulk-action-bar";
import { BulkUpdateModal } from "../components/bulk-update-modal";
import { batchExecute, generateCsv, downloadFile } from "../utils/bulk-operations";
import { addToast } from "../stores/notifications";

export function DataBrowser() {
  const params = useParams<{ entity?: string }>();
  const navigate = useNavigate();
  const { entities, load: loadEntities, entityNames, parsed: allEntitiesParsed } = useEntities();
  const { load: loadRelations, forSource } = useRelations();

  const [entityDef, setEntityDef] = createSignal<EntityDefinition | null>(null);
  const [records, setRecords] = createSignal<Record<string, unknown>[]>([]);
  const [total, setTotal] = createSignal(0);
  const [page, setPage] = createSignal(1);
  const [perPage] = createSignal(25);
  const [sortField, setSortField] = createSignal("");
  const [sortDir, setSortDir] = createSignal<"ASC" | "DESC">("ASC");
  const [filters, setFilters] = createSignal<FilterParam[]>([]);
  const [loading, setLoading] = createSignal(false);

  // Editor state
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingRecord, setEditingRecord] = createSignal<Record<string, unknown> | null>(null);
  const [editorSaving, setEditorSaving] = createSignal(false);
  const [editorError, setEditorError] = createSignal<string | null>(null);

  // Delete state
  const [deleteTarget, setDeleteTarget] = createSignal<string | null>(null);

  // CSV import state
  const [csvImportOpen, setCsvImportOpen] = createSignal(false);

  // Bulk operations state
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = createSignal(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = createSignal(false);
  const [bulkUpdateOpen, setBulkUpdateOpen] = createSignal(false);

  onMount(() => {
    loadEntities();
    loadRelations();
  });

  // When entity param changes, load the entity definition and data
  createEffect(() => {
    const name = params.entity;
    if (!name) {
      setEntityDef(null);
      setRecords([]);
      return;
    }

    const ents = entities();
    const row = ents.find((e) => e.name === name);
    if (row) {
      setEntityDef(parseDefinition(row));
      setPage(1);
      setFilters([]);
      setSortField("");
      setSelectedIds(new Set<string>());
      fetchData(name);
    }
  });

  async function fetchData(entityName?: string) {
    const name = entityName ?? params.entity;
    if (!name) return;

    setLoading(true);
    try {
      const sortStr = sortField()
        ? (sortDir() === "DESC" ? `-${sortField()}` : sortField())
        : undefined;

      const res = await listRecords(name, {
        filters: filters(),
        sort: sortStr,
        page: page(),
        perPage: perPage(),
      });
      setRecords(res.data);
      setTotal(res.meta?.total ?? res.data.length);
      setSelectedIds(new Set<string>());
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to load records");
      }
    } finally {
      setLoading(false);
    }
  }

  const handleSort = (field: string) => {
    if (sortField() === field) {
      setSortDir((d) => (d === "ASC" ? "DESC" : "ASC"));
    } else {
      setSortField(field);
      setSortDir("ASC");
    }
    fetchData();
  };

  const handlePageChange = (p: number) => {
    setPage(p);
    setSelectedIds(new Set<string>());
    fetchData();
  };

  const getRowId = (row: Record<string, unknown>): string => {
    const def = entityDef();
    const pkField = def?.primary_key.field ?? "id";
    return String(row[pkField]);
  };

  const columns = (): Column[] => {
    const def = entityDef();
    if (!def) return [];

    const cols: Column[] = def.fields.map((f) => ({
      key: f.name,
      header: f.name,
      sortable: true,
      class: f.type === "uuid" ? "table-cell-mono" : "table-cell",
      render: (val: unknown): JSX.Element => {
        if (val === null || val === undefined) {
          return <span class="text-gray-300 dark:text-gray-600">null</span>;
        }
        if (f.type === "boolean") {
          return <span>{val ? "true" : "false"}</span>;
        }
        if (f.type === "json") {
          const str = typeof val === "string" ? val : JSON.stringify(val);
          return (
            <span class="font-mono text-xs" title={str}>
              {str.length > 50 ? str.slice(0, 50) + "..." : str}
            </span>
          );
        }
        if (f.type === "timestamp" || f.type === "date") {
          const d = new Date(String(val));
          return <span>{isNaN(d.getTime()) ? String(val) : d.toLocaleString()}</span>;
        }
        if (f.type === "uuid") {
          const s = String(val);
          return <span title={s}>{s.slice(0, 8)}...</span>;
        }
        return <span>{String(val)}</span>;
      },
    }));

    // Actions column
    cols.push({
      key: "_actions",
      header: "",
      class: "table-cell-actions",
      render: (_: unknown, row: Record<string, unknown>): JSX.Element => {
        const pkField = def.primary_key.field;
        const id = String(row[pkField]);
        return (
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
                setDeleteTarget(id);
              }}
            >
              Delete
            </button>
          </div>
        );
      },
    });

    return cols;
  };

  const openCreate = () => {
    setEditingRecord(null);
    setEditorError(null);
    setEditorOpen(true);
  };

  const openEdit = async (record: Record<string, unknown>) => {
    const entityName = params.entity;
    const def = entityDef();
    if (!entityName || !def) return;

    setEditorError(null);

    // Find source relations to determine if we need includes
    const rels = forSource(entityName);
    const includeNames = rels.map((r) => r.name).join(",");

    if (includeNames) {
      try {
        const id = String(record[def.primary_key.field]);
        const res = await getRecord(entityName, id, { include: includeNames });
        setEditingRecord(res.data);
      } catch {
        setEditingRecord(record); // Fallback to flat record
      }
    } else {
      setEditingRecord(record);
    }

    setEditorOpen(true);
  };

  const handleSaveRecord = async (data: Record<string, unknown>) => {
    const def = entityDef();
    const entityName = params.entity;
    if (!def || !entityName) return;

    setEditorSaving(true);
    setEditorError(null);

    try {
      const existing = editingRecord();
      if (existing) {
        const id = String(existing[def.primary_key.field]);
        await updateRecord(entityName, id, data);
        addToast("success", "Record updated");
      } else {
        await createRecord(entityName, data);
        addToast("success", "Record created");
      }
      setEditorOpen(false);
      await fetchData();
    } catch (err) {
      if (isApiError(err)) {
        let msg = err.error.message;
        if (err.error.details) {
          msg += ": " + err.error.details.map((d) => `${d.field ?? ""} ${d.message}`).join(", ");
        }
        setEditorError(msg);
      } else {
        setEditorError("Failed to save record");
      }
    } finally {
      setEditorSaving(false);
    }
  };

  const handleDeleteRecord = async () => {
    const id = deleteTarget();
    const entityName = params.entity;
    if (!id || !entityName) return;

    try {
      await deleteRecord(entityName, id);
      addToast("success", "Record deleted");
      setDeleteTarget(null);
      await fetchData();
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to delete record");
      }
      setDeleteTarget(null);
    }
  };

  // ── Bulk Operations ──────────────────────────────

  const handleSelectAll = () => {
    const ids = new Set(records().map(getRowId));
    setSelectedIds(ids);
  };

  const handleBulkDelete = async () => {
    const entityName = params.entity;
    if (!entityName) return;

    setBulkDeleteOpen(false);
    setBulkLoading(true);

    const ids = Array.from(selectedIds());
    const results = await batchExecute(ids, (id) =>
      deleteRecord(entityName, id).then(() => {}),
    );

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      addToast("success", `${succeeded} record(s) deleted`);
    } else {
      addToast("error", `${succeeded} deleted, ${failed} failed`);
    }

    setSelectedIds(new Set<string>());
    setBulkLoading(false);
    await fetchData();
  };

  const handleBulkUpdate = async (field: string, value: unknown) => {
    const entityName = params.entity;
    if (!entityName) return;

    setBulkUpdateOpen(false);
    setBulkLoading(true);

    const ids = Array.from(selectedIds());
    const results = await batchExecute(ids, (id) =>
      updateRecord(entityName, id, { [field]: value }).then(() => {}),
    );

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (failed === 0) {
      addToast("success", `${succeeded} record(s) updated`);
    } else {
      addToast("error", `${succeeded} updated, ${failed} failed`);
    }

    setSelectedIds(new Set<string>());
    setBulkLoading(false);
    await fetchData();
  };

  const handleExport = async () => {
    const def = entityDef();
    const entityName = params.entity;
    if (!def || !entityName) return;

    const fieldNames = [def.primary_key.field, ...def.fields.map((f) => f.name)];
    const selected = selectedIds();

    let exportRecords: Record<string, unknown>[];

    if (selected.size > 0) {
      // Export selected records from current page
      exportRecords = records().filter((r) => selected.has(getRowId(r)));
    } else {
      // Export all records (paginate through everything)
      setBulkLoading(true);
      exportRecords = [];
      let pg = 1;
      const pp = 100;
      let hasMore = true;

      while (hasMore) {
        try {
          const sortStr = sortField()
            ? (sortDir() === "DESC" ? `-${sortField()}` : sortField())
            : undefined;
          const res = await listRecords(entityName, {
            filters: filters(),
            sort: sortStr,
            page: pg,
            perPage: pp,
          });
          exportRecords.push(...res.data);
          hasMore = res.data.length === pp;
          pg++;
        } catch {
          addToast("error", "Failed to fetch all records for export");
          setBulkLoading(false);
          return;
        }
      }
      setBulkLoading(false);
    }

    const csv = generateCsv(fieldNames, exportRecords);
    const date = new Date().toISOString().split("T")[0];
    downloadFile(csv, `${entityName}-export-${date}.csv`);
    addToast("success", `Exported ${exportRecords.length} record(s)`);
  };

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">Data Browser</h1>
          <p class="page-subtitle">Browse and manage entity data</p>
        </div>
        <div class="flex items-center gap-3">
          <select
            class="form-select"
            style="width: 200px"
            value={params.entity ?? ""}
            onChange={(e) => {
              const val = e.currentTarget.value;
              if (val) navigate(`/data/${val}`);
              else navigate("/data");
            }}
          >
            <option value="">Select entity...</option>
            {entityNames().map((n) => (
              <option value={n}>{n}</option>
            ))}
          </select>
          <Show when={entityDef()}>
            <button
              class="btn-secondary"
              onClick={handleExport}
              disabled={bulkLoading()}
            >
              Export CSV
            </button>
            <button class="btn-secondary" onClick={() => setCsvImportOpen(true)}>
              Import CSV
            </button>
            <button class="btn-primary" onClick={openCreate}>
              Create Record
            </button>
          </Show>
        </div>
      </div>

      <Show when={entityDef()}>
        {(def) => (
          <>
            <FilterBar
              fields={def().fields}
              filters={filters()}
              onChange={setFilters}
              onApply={() => {
                setPage(1);
                fetchData();
              }}
            />

            <Show when={selectedIds().size > 0}>
              <BulkActionBar
                selectedCount={selectedIds().size}
                totalCount={records().length}
                onSelectAll={handleSelectAll}
                onDeselectAll={() => setSelectedIds(new Set())}
                onDelete={() => setBulkDeleteOpen(true)}
                onUpdate={() => setBulkUpdateOpen(true)}
                onExport={handleExport}
                loading={bulkLoading()}
              />
            </Show>

            {loading() ? (
              <p class="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
            ) : (
              <>
                <DataTable
                  columns={columns()}
                  rows={records()}
                  sortField={sortField()}
                  sortDir={sortDir()}
                  onSort={handleSort}
                  emptyMessage="No records found."
                  selectable
                  selectedIds={selectedIds()}
                  onSelectionChange={setSelectedIds}
                  rowId={getRowId}
                />
                <Pagination
                  page={page()}
                  perPage={perPage()}
                  total={total()}
                  onPageChange={handlePageChange}
                />
              </>
            )}

            <Modal
              open={editorOpen()}
              onClose={() => setEditorOpen(false)}
              title={editingRecord() ? "Edit Record" : "Create Record"}
              wide={!forSource(params.entity!).length}
              fullscreen={forSource(params.entity!).length > 0}
            >
              <DataRecordEditor
                entity={def()}
                record={editingRecord()}
                onSave={handleSaveRecord}
                onCancel={() => setEditorOpen(false)}
                saving={editorSaving()}
                error={editorError()}
                relations={forSource(params.entity!)}
                allEntities={allEntitiesParsed()}
              />
            </Modal>

            <ConfirmDialog
              open={deleteTarget() !== null}
              title="Delete Record"
              message={`Are you sure you want to delete this record?`}
              onConfirm={handleDeleteRecord}
              onCancel={() => setDeleteTarget(null)}
            />

            <ConfirmDialog
              open={bulkDeleteOpen()}
              title="Delete Selected Records"
              message={`Are you sure you want to delete ${selectedIds().size} record(s)? This cannot be undone.`}
              confirmLabel={`Delete ${selectedIds().size} record(s)`}
              onConfirm={handleBulkDelete}
              onCancel={() => setBulkDeleteOpen(false)}
            />

            <BulkUpdateModal
              open={bulkUpdateOpen()}
              onClose={() => setBulkUpdateOpen(false)}
              entity={def()}
              selectedCount={selectedIds().size}
              onConfirm={handleBulkUpdate}
            />

            <Modal
              open={csvImportOpen()}
              onClose={() => setCsvImportOpen(false)}
              title={`Import CSV — ${def().name}`}
              wide
            >
              <CsvImport
                entity={def()}
                onDone={(count) => {
                  setCsvImportOpen(false);
                  if (count > 0) {
                    addToast("success", `Imported ${count} record(s)`);
                    fetchData();
                  }
                }}
                onCancel={() => setCsvImportOpen(false)}
              />
            </Modal>
          </>
        )}
      </Show>

      <Show when={!params.entity}>
        <div class="section">
          <p class="text-gray-500 dark:text-gray-400 text-sm">
            Select an entity from the dropdown above to browse its data.
          </p>
        </div>
      </Show>
    </div>
  );
}
