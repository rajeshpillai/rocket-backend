import { createSignal, onMount, type JSX } from "solid-js";
import {
  listPermissions,
  createPermission,
  updatePermission,
  deletePermission,
} from "../api/permissions";
import {
  parseConditions,
  emptyPermission,
  type PermissionRow,
  type PermissionPayload,
} from "../types/permission";
import { isApiError } from "../types/api";
import { useEntities } from "../stores/entities";
import { DataTable, type Column } from "../components/data-table";
import { Modal } from "../components/modal";
import { ConfirmDialog } from "../components/confirm-dialog";
import { Badge } from "../components/badge";
import { addToast } from "../stores/notifications";

const actionColors: Record<string, "green" | "blue" | "purple" | "red"> = {
  read: "green",
  create: "blue",
  update: "purple",
  delete: "red",
};

export function PermissionsList() {
  const { entityNames, load: loadEntities } = useEntities();
  const [permissions, setPermissions] = createSignal<PermissionRow[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingPerm, setEditingPerm] = createSignal<PermissionPayload>(emptyPermission());
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [editorError, setEditorError] = createSignal<string | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<string | null>(null);
  const [rolesInput, setRolesInput] = createSignal("");
  const [conditionsJson, setConditionsJson] = createSignal("[]");

  async function loadPerms() {
    setLoading(true);
    try {
      const res = await listPermissions();
      setPermissions(res.data);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadPerms();
    loadEntities();
  });

  type Row = PermissionRow & {
    conditionCount: number;
    rolesList: string[];
  };

  const rows = (): Row[] =>
    permissions().map((row) => ({
      ...row,
      conditionCount: parseConditions(row).length,
      rolesList: row.roles ?? [],
    }));

  const openCreate = () => {
    setEditingPerm(emptyPermission());
    setEditingId(null);
    setEditorError(null);
    setRolesInput("");
    setConditionsJson("[]");
    setEditorOpen(true);
  };

  const openEdit = (row: PermissionRow) => {
    const conds = parseConditions(row);
    setEditingPerm({
      id: row.id,
      entity: row.entity,
      action: row.action,
      roles: row.roles ?? [],
      conditions: conds,
    });
    setEditingId(row.id);
    setEditorError(null);
    setRolesInput((row.roles ?? []).join(", "));
    setConditionsJson(JSON.stringify(conds, null, 2));
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const perm = editingPerm();
    if (!perm.entity) {
      setEditorError("Entity is required");
      return;
    }
    if (!perm.action) {
      setEditorError("Action is required");
      return;
    }

    const roles = rolesInput()
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    let conditions;
    try {
      conditions = JSON.parse(conditionsJson());
    } catch {
      setEditorError("Invalid JSON in conditions");
      return;
    }

    const payload: PermissionPayload = {
      entity: perm.entity,
      action: perm.action,
      roles,
      conditions,
    };

    setSaving(true);
    setEditorError(null);

    try {
      if (editingId()) {
        await updatePermission(editingId()!, payload);
        addToast("success", "Permission updated");
      } else {
        await createPermission(payload);
        addToast("success", "Permission created");
      }
      setEditorOpen(false);
      await loadPerms();
    } catch (err) {
      if (isApiError(err)) {
        setEditorError(err.error.message);
      } else {
        setEditorError("Failed to save permission");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const id = deleteTarget();
    if (!id) return;
    try {
      await deletePermission(id);
      addToast("success", "Permission deleted");
      setDeleteTarget(null);
      await loadPerms();
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to delete permission");
      }
      setDeleteTarget(null);
    }
  };

  const columns: Column<Row>[] = [
    { key: "entity", header: "Entity" },
    {
      key: "action",
      header: "Action",
      render: (val): JSX.Element => (
        <Badge
          label={String(val)}
          color={actionColors[String(val)] ?? "gray"}
        />
      ),
    },
    {
      key: "rolesList",
      header: "Roles",
      render: (val): JSX.Element => (
        <div class="flex gap-1 flex-wrap">
          {(val as string[]).map((role: string) => (
            <Badge label={role} color="blue" />
          ))}
        </div>
      ),
    },
    {
      key: "conditionCount",
      header: "Conditions",
      render: (val): JSX.Element => (
        <span class="text-sm text-gray-500">
          {val === 0 ? "None" : `${val} condition${val === 1 ? "" : "s"}`}
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
          <h1 class="page-title">Permissions</h1>
          <p class="page-subtitle">Manage role-based access policies</p>
        </div>
        <button class="btn-primary" onClick={openCreate}>
          Create Permission
        </button>
      </div>

      {loading() ? (
        <p class="text-sm text-gray-500">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={rows()}
          emptyMessage="No permissions yet. Create one to define access policies."
        />
      )}

      <Modal
        open={editorOpen()}
        onClose={() => setEditorOpen(false)}
        title={editingId() ? "Edit Permission" : "Create Permission"}
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
              value={editingPerm().entity}
              onChange={(e) =>
                setEditingPerm({ ...editingPerm(), entity: e.currentTarget.value })
              }
            >
              <option value="">Select entity...</option>
              {entityNames().map((name) => (
                <option value={name}>{name}</option>
              ))}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Action</label>
            <select
              class="form-input"
              value={editingPerm().action}
              onChange={(e) =>
                setEditingPerm({ ...editingPerm(), action: e.currentTarget.value })
              }
            >
              <option value="read">read</option>
              <option value="create">create</option>
              <option value="update">update</option>
              <option value="delete">delete</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Roles (comma-separated)</label>
            <input
              type="text"
              class="form-input"
              value={rolesInput()}
              onInput={(e) => setRolesInput(e.currentTarget.value)}
              placeholder="viewer, editor, manager"
            />
          </div>

          <div class="form-group">
            <label class="form-label">Conditions (JSON)</label>
            <textarea
              class="form-input font-mono"
              rows={4}
              value={conditionsJson()}
              onInput={(e) => setConditionsJson(e.currentTarget.value)}
              placeholder='[{"field": "status", "operator": "eq", "value": "active"}]'
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
        title="Delete Permission"
        message="Are you sure you want to delete this permission?"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
