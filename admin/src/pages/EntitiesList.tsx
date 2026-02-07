import { createSignal, onMount, type JSX } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useEntities } from "../stores/entities";
import { deleteEntity } from "../api/entities";
import { parseDefinition, type EntityRow } from "../types/entity";
import { isApiError } from "../types/api";
import { DataTable, type Column } from "../components/DataTable";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Badge } from "../components/Badge";
import { addToast } from "../stores/notifications";

export function EntitiesList() {
  const navigate = useNavigate();
  const { entities, loading, load } = useEntities();
  const [deleteTarget, setDeleteTarget] = createSignal<string | null>(null);

  onMount(() => load());

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
      <div class="page-header">
        <div>
          <h1 class="page-title">Entities</h1>
          <p class="page-subtitle">Manage your data entities and their fields</p>
        </div>
        <button class="btn-primary" onClick={() => navigate("/entities/new")}>
          Create Entity
        </button>
      </div>

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
    </div>
  );
}
