import { createSignal, onMount, type JSX } from "solid-js";
import { listRelations, createRelation, updateRelation, deleteRelation } from "../api/relations";
import { parseRelationDefinition, type RelationRow, type RelationDefinition } from "../types/relation";
import { isApiError } from "../types/api";
import { useEntities } from "../stores/entities";
import { DataTable, type Column } from "../components/data-table";
import { Modal } from "../components/modal";
import { ConfirmDialog } from "../components/confirm-dialog";
import { Badge } from "../components/badge";
import { RelationEditor } from "./relation-editor";
import { addToast } from "../stores/notifications";

const emptyRelation = (): RelationDefinition => ({
  name: "",
  type: "one_to_many",
  source: "",
  target: "",
  source_key: "id",
  target_key: "",
  ownership: "source",
  on_delete: "cascade",
  fetch: "lazy",
  write_mode: "diff",
});

const typeColor: Record<string, "blue" | "purple" | "green"> = {
  one_to_one: "green",
  one_to_many: "blue",
  many_to_many: "purple",
};

export function RelationsList() {
  const { entityNames, load: loadEntities } = useEntities();
  const [relations, setRelations] = createSignal<RelationRow[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingRelation, setEditingRelation] = createSignal<RelationDefinition>(emptyRelation());
  const [editingOriginalName, setEditingOriginalName] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [editorError, setEditorError] = createSignal<string | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<string | null>(null);

  async function loadRelations() {
    setLoading(true);
    try {
      const res = await listRelations();
      setRelations(res.data);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadRelations();
    loadEntities();
  });

  const rows = () =>
    relations().map((row) => {
      const def = parseRelationDefinition(row);
      return {
        name: def.name,
        type: def.type,
        source: def.source,
        target: def.target,
        write_mode: def.write_mode ?? "diff",
        _def: def,
      };
    });

  const openCreate = () => {
    setEditingRelation(emptyRelation());
    setEditingOriginalName(null);
    setEditorError(null);
    setEditorOpen(true);
  };

  const openEdit = (def: RelationDefinition) => {
    setEditingRelation({ ...def });
    setEditingOriginalName(def.name);
    setEditorError(null);
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const rel = editingRelation();
    if (!rel.name.trim()) {
      setEditorError("Relation name is required");
      return;
    }

    setSaving(true);
    setEditorError(null);

    try {
      if (editingOriginalName()) {
        await updateRelation(editingOriginalName()!, rel);
        addToast("success", `Relation "${rel.name}" updated`);
      } else {
        await createRelation(rel);
        addToast("success", `Relation "${rel.name}" created`);
      }
      setEditorOpen(false);
      await loadRelations();
    } catch (err) {
      if (isApiError(err)) {
        setEditorError(err.error.message);
      } else {
        setEditorError("Failed to save relation");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const name = deleteTarget();
    if (!name) return;
    try {
      await deleteRelation(name);
      addToast("success", `Relation "${name}" deleted`);
      setDeleteTarget(null);
      await loadRelations();
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to delete relation");
      }
      setDeleteTarget(null);
    }
  };

  type Row = { name: string; type: string; source: string; target: string; write_mode: string; _def: RelationDefinition };

  const columns: Column<Row>[] = [
    { key: "name", header: "Name" },
    {
      key: "type",
      header: "Type",
      render: (val): JSX.Element => (
        <Badge
          label={String(val).replace(/_/g, " ")}
          color={typeColor[String(val)] ?? "gray"}
        />
      ),
    },
    {
      key: "source",
      header: "Source → Target",
      render: (_, row): JSX.Element => (
        <span class="font-mono text-xs">
          {row.source} → {row.target}
        </span>
      ),
    },
    {
      key: "write_mode",
      header: "Write Mode",
      render: (val): JSX.Element => <Badge label={String(val)} color="gray" />,
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
              openEdit(row._def);
            }}
          >
            Edit
          </button>
          <button
            class="btn-danger btn-sm"
            onClick={(e: Event) => {
              e.stopPropagation();
              setDeleteTarget(row.name);
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
          <h1 class="page-title">Relations</h1>
          <p class="page-subtitle">Manage entity relationships</p>
        </div>
        <button class="btn-primary" onClick={openCreate}>
          Create Relation
        </button>
      </div>

      {loading() ? (
        <p class="text-sm text-gray-500">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={rows()}
          emptyMessage="No relations yet. Create one to link entities."
        />
      )}

      <Modal
        open={editorOpen()}
        onClose={() => setEditorOpen(false)}
        title={editingOriginalName() ? "Edit Relation" : "Create Relation"}
        wide
      >
        <RelationEditor
          relation={editingRelation()}
          entityNames={entityNames()}
          onChange={setEditingRelation}
          onSave={handleSave}
          onCancel={() => setEditorOpen(false)}
          saving={saving()}
          error={editorError()}
        />
      </Modal>

      <ConfirmDialog
        open={deleteTarget() !== null}
        title="Delete Relation"
        message={`Are you sure you want to delete relation "${deleteTarget()}"?`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
