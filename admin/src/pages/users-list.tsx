import { createSignal, onMount, type JSX } from "solid-js";
import { listUsers, createUser, updateUser, deleteUser } from "../api/users";
import { emptyUser, type UserRow, type UserPayload } from "../types/user";
import { isApiError } from "../types/api";
import { DataTable, type Column } from "../components/data-table";
import { Modal } from "../components/modal";
import { ConfirmDialog } from "../components/confirm-dialog";
import { Badge } from "../components/badge";
import { addToast } from "../stores/notifications";

export function UsersList() {
  const [users, setUsers] = createSignal<UserRow[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingUser, setEditingUser] = createSignal<UserPayload>(emptyUser());
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [editorError, setEditorError] = createSignal<string | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<string | null>(null);
  const [rolesInput, setRolesInput] = createSignal("");

  async function loadUsers() {
    setLoading(true);
    try {
      const res = await listUsers();
      setUsers(res.data);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadUsers();
  });

  const openCreate = () => {
    setEditingUser(emptyUser());
    setEditingId(null);
    setEditorError(null);
    setRolesInput("");
    setEditorOpen(true);
  };

  const openEdit = (row: UserRow) => {
    setEditingUser({
      email: row.email,
      roles: row.roles ?? [],
      active: row.active,
    });
    setEditingId(row.id);
    setEditorError(null);
    setRolesInput((row.roles ?? []).join(", "));
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const user = editingUser();
    if (!user.email) {
      setEditorError("Email is required");
      return;
    }
    if (!editingId() && !user.password) {
      setEditorError("Password is required for new users");
      return;
    }

    // Parse roles from comma-separated input
    const roles = rolesInput()
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    const payload = { ...user, roles };

    setSaving(true);
    setEditorError(null);

    try {
      if (editingId()) {
        await updateUser(editingId()!, payload);
        addToast("success", "User updated");
      } else {
        await createUser(payload);
        addToast("success", "User created");
      }
      setEditorOpen(false);
      await loadUsers();
    } catch (err) {
      if (isApiError(err)) {
        setEditorError(err.error.message);
      } else {
        setEditorError("Failed to save user");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const id = deleteTarget();
    if (!id) return;
    try {
      await deleteUser(id);
      addToast("success", "User deleted");
      setDeleteTarget(null);
      await loadUsers();
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to delete user");
      }
      setDeleteTarget(null);
    }
  };

  const columns: Column<UserRow>[] = [
    { key: "email", header: "Email" },
    {
      key: "roles",
      header: "Roles",
      render: (val): JSX.Element => (
        <div class="flex gap-1 flex-wrap">
          {(val as string[] ?? []).map((role: string) => (
            <Badge label={role} color={role === "admin" ? "purple" : "blue"} />
          ))}
        </div>
      ),
    },
    {
      key: "active",
      header: "Active",
      render: (val): JSX.Element => (
        <Badge label={val ? "yes" : "no"} color={val ? "green" : "gray"} />
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
          <h1 class="page-title">Users</h1>
          <p class="page-subtitle">Manage user accounts and roles</p>
        </div>
        <button class="btn-primary" onClick={openCreate}>
          Create User
        </button>
      </div>

      {loading() ? (
        <p class="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={users()}
          emptyMessage="No users yet."
        />
      )}

      <Modal
        open={editorOpen()}
        onClose={() => setEditorOpen(false)}
        title={editingId() ? "Edit User" : "Create User"}
      >
        <div class="form-stack">
          {editorError() && (
            <div class="form-error">{editorError()}</div>
          )}

          <div class="form-group">
            <label class="form-label">Email</label>
            <input
              type="email"
              class="form-input"
              value={editingUser().email}
              onInput={(e) =>
                setEditingUser({ ...editingUser(), email: e.currentTarget.value })
              }
              placeholder="user@example.com"
            />
          </div>

          <div class="form-group">
            <label class="form-label">
              Password {editingId() ? "(leave blank to keep current)" : ""}
            </label>
            <input
              type="password"
              class="form-input"
              value={editingUser().password ?? ""}
              onInput={(e) =>
                setEditingUser({ ...editingUser(), password: e.currentTarget.value })
              }
              placeholder={editingId() ? "Unchanged" : "Password"}
            />
          </div>

          <div class="form-group">
            <label class="form-label">Roles (comma-separated)</label>
            <input
              type="text"
              class="form-input"
              value={rolesInput()}
              onInput={(e) => setRolesInput(e.currentTarget.value)}
              placeholder="admin, editor, viewer"
            />
          </div>

          <div class="form-group">
            <label class="form-label flex items-center gap-2">
              <input
                type="checkbox"
                checked={editingUser().active}
                onChange={(e) =>
                  setEditingUser({ ...editingUser(), active: e.currentTarget.checked })
                }
              />
              Active
            </label>
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
        title="Delete User"
        message="Are you sure you want to delete this user? This action cannot be undone."
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
