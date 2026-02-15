import { createSignal, onMount, For, Show, type JSX } from "solid-js";
import { listInvites, createInvite, deleteInvite, bulkCreateInvites } from "../api/invites";
import type { InviteRow, InvitePayload } from "../types/invite";
import type { BulkInviteResult, BulkInviteCreated } from "../types/invite";
import { isApiError } from "../types/api";
import { DataTable, type Column } from "../components/data-table";
import { Modal } from "../components/modal";
import { ConfirmDialog } from "../components/confirm-dialog";
import { Badge } from "../components/badge";
import { addToast } from "../stores/notifications";

type BadgeColor = "blue" | "green" | "red" | "gray" | "purple" | "yellow";

function inviteStatus(row: InviteRow): { label: string; color: BadgeColor } {
  if (row.accepted_at) return { label: "accepted", color: "green" };
  if (new Date(row.expires_at) < new Date()) return { label: "expired", color: "gray" };
  return { label: "pending", color: "yellow" };
}

export function InvitesList() {
  const [invites, setInvites] = createSignal<InviteRow[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [editorError, setEditorError] = createSignal<string | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<string | null>(null);
  const [email, setEmail] = createSignal("");
  const [rolesInput, setRolesInput] = createSignal("");
  const [createdToken, setCreatedToken] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);

  // Bulk invite state
  const [bulkOpen, setBulkOpen] = createSignal(false);
  const [bulkEmails, setBulkEmails] = createSignal("");
  const [bulkRoles, setBulkRoles] = createSignal("");
  const [bulkSaving, setBulkSaving] = createSignal(false);
  const [bulkError, setBulkError] = createSignal<string | null>(null);
  const [bulkResult, setBulkResult] = createSignal<BulkInviteResult | null>(null);
  const [copiedTokens, setCopiedTokens] = createSignal<Set<string>>(new Set());

  async function loadInvites() {
    setLoading(true);
    try {
      const res = await listInvites();
      setInvites(res.data);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadInvites();
  });

  const openCreate = () => {
    setEmail("");
    setRolesInput("");
    setEditorError(null);
    setCreatedToken(null);
    setCopied(false);
    setEditorOpen(true);
  };

  const openBulk = () => {
    setBulkEmails("");
    setBulkRoles("");
    setBulkError(null);
    setBulkResult(null);
    setCopiedTokens(new Set<string>());
    setBulkOpen(true);
  };

  const handleSave = async () => {
    if (!email()) {
      setEditorError("Email is required");
      return;
    }

    const roles = rolesInput()
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    const payload: InvitePayload = { email: email(), roles };

    setSaving(true);
    setEditorError(null);

    try {
      const res = await createInvite(payload);
      setCreatedToken(res.data.token);
      addToast("success", "Invite created");
      await loadInvites();
    } catch (err) {
      if (isApiError(err)) {
        setEditorError(err.error.message);
      } else {
        setEditorError("Failed to create invite");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleBulkSave = async () => {
    const raw = bulkEmails().trim();
    if (!raw) {
      setBulkError("Enter at least one email address");
      return;
    }

    const emails = raw
      .split(/[\n,]+/)
      .map((e) => e.trim())
      .filter((e) => e.length > 0);

    if (emails.length === 0) {
      setBulkError("Enter at least one email address");
      return;
    }

    const roles = bulkRoles()
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    setBulkSaving(true);
    setBulkError(null);

    try {
      const res = await bulkCreateInvites({ emails, roles });
      setBulkResult(res.data);
      addToast("success", `Created ${res.data.summary.created} of ${res.data.summary.total} invites`);
      await loadInvites();
    } catch (err) {
      if (isApiError(err)) {
        setBulkError(err.error.message);
      } else {
        setBulkError("Failed to create invites");
      }
    } finally {
      setBulkSaving(false);
    }
  };

  const handleCopy = async () => {
    const token = createdToken();
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      addToast("success", "Token copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast("error", "Failed to copy token");
    }
  };

  const handleCopyBulkToken = async (item: BulkInviteCreated) => {
    try {
      await navigator.clipboard.writeText(item.token);
      setCopiedTokens((prev) => new Set([...prev, item.email]));
      setTimeout(() => {
        setCopiedTokens((prev) => {
          const next = new Set(prev);
          next.delete(item.email);
          return next;
        });
      }, 2000);
    } catch {
      addToast("error", "Failed to copy token");
    }
  };

  const handleCopyAllTokens = async () => {
    const result = bulkResult();
    if (!result || result.created.length === 0) return;
    const text = result.created.map((c) => `${c.email}\t${c.token}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      addToast("success", "All tokens copied to clipboard");
    } catch {
      addToast("error", "Failed to copy tokens");
    }
  };

  const handleDelete = async () => {
    const id = deleteTarget();
    if (!id) return;
    try {
      await deleteInvite(id);
      addToast("success", "Invite revoked");
      setDeleteTarget(null);
      await loadInvites();
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to revoke invite");
      }
      setDeleteTarget(null);
    }
  };

  const columns: Column<InviteRow>[] = [
    { key: "email", header: "Email" },
    {
      key: "roles",
      header: "Roles",
      render: (val): JSX.Element => (
        <div class="flex gap-1 flex-wrap">
          {((val as string[]) ?? []).map((role: string) => (
            <Badge label={role} color={role === "admin" ? "purple" : "blue"} />
          ))}
        </div>
      ),
    },
    {
      key: "status" as any,
      header: "Status",
      render: (_val, row): JSX.Element => {
        const s = inviteStatus(row);
        return <Badge label={s.label} color={s.color} />;
      },
    },
    {
      key: "expires_at",
      header: "Expires",
      render: (val): JSX.Element => (
        <span class="text-sm text-gray-500">
          {val ? new Date(val as string).toLocaleString() : "-"}
        </span>
      ),
    },
    {
      key: "created_at",
      header: "Created",
      render: (val): JSX.Element => (
        <span class="text-sm text-gray-500">
          {val ? new Date(val as string).toLocaleString() : "-"}
        </span>
      ),
    },
    {
      key: "_actions",
      header: "",
      class: "table-cell-actions",
      render: (_, row): JSX.Element => {
        const s = inviteStatus(row);
        return (
          <div class="flex items-center justify-end gap-2">
            {s.label === "pending" && (
              <button
                class="btn-danger btn-sm"
                onClick={(e: Event) => {
                  e.stopPropagation();
                  setDeleteTarget(row.id);
                }}
              >
                Revoke
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">Invites</h1>
          <p class="page-subtitle">Invite users to join the application</p>
        </div>
        <div class="flex gap-2">
          <button class="btn-secondary" onClick={openBulk}>
            Bulk Invite
          </button>
          <button class="btn-primary" onClick={openCreate}>
            Send Invite
          </button>
        </div>
      </div>

      {loading() ? (
        <p class="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={invites()}
          emptyMessage="No invites yet."
        />
      )}

      {/* Single invite modal */}
      <Modal
        open={editorOpen()}
        onClose={() => setEditorOpen(false)}
        title={createdToken() ? "Invite Created" : "Send Invite"}
      >
        <div class="form-stack">
          {editorError() && (
            <div class="form-error">{editorError()}</div>
          )}

          {createdToken() ? (
            <div>
              <p class="text-sm mb-2">
                Share this invite token with the user. They will use it to set their password and activate their account.
              </p>
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  class="form-input font-mono text-sm"
                  value={createdToken()!}
                  readOnly
                />
                <button
                  class="btn-secondary btn-sm"
                  style="white-space: nowrap"
                  onClick={handleCopy}
                >
                  {copied() ? "Copied!" : "Copy"}
                </button>
              </div>
              <div class="flex justify-end gap-2 mt-4">
                <button
                  class="btn-primary"
                  onClick={() => setEditorOpen(false)}
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              <div class="form-group">
                <label class="form-label">Email</label>
                <input
                  type="email"
                  class="form-input"
                  value={email()}
                  onInput={(e) => setEmail(e.currentTarget.value)}
                  placeholder="user@example.com"
                />
              </div>

              <div class="form-group">
                <label class="form-label">Roles (comma-separated)</label>
                <input
                  type="text"
                  class="form-input"
                  value={rolesInput()}
                  onInput={(e) => setRolesInput(e.currentTarget.value)}
                  placeholder="editor, viewer"
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
                  {saving() ? "Sending..." : "Send Invite"}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Bulk invite modal */}
      <Modal
        open={bulkOpen()}
        onClose={() => setBulkOpen(false)}
        title={bulkResult() ? "Bulk Invite Results" : "Bulk Invite"}
      >
        <div class="form-stack">
          {bulkError() && (
            <div class="form-error">{bulkError()}</div>
          )}

          <Show when={bulkResult()} fallback={
            <>
              <div class="form-group">
                <label class="form-label">Email Addresses</label>
                <textarea
                  class="form-input font-mono text-sm"
                  rows={8}
                  value={bulkEmails()}
                  onInput={(e) => setBulkEmails(e.currentTarget.value)}
                  placeholder={"alice@example.com\nbob@example.com\ncharlie@example.com\n\nOne email per line, or comma-separated"}
                />
              </div>

              <div class="form-group">
                <label class="form-label">Roles for all invitees (comma-separated)</label>
                <input
                  type="text"
                  class="form-input"
                  value={bulkRoles()}
                  onInput={(e) => setBulkRoles(e.currentTarget.value)}
                  placeholder="editor, viewer"
                />
              </div>

              <div class="flex justify-end gap-2 mt-4">
                <button
                  class="btn-secondary"
                  onClick={() => setBulkOpen(false)}
                >
                  Cancel
                </button>
                <button
                  class="btn-primary"
                  onClick={handleBulkSave}
                  disabled={bulkSaving()}
                >
                  {bulkSaving() ? "Sending..." : "Send Invites"}
                </button>
              </div>
            </>
          }>
            {(result) => (
              <div>
                {/* Summary */}
                <div class={`text-sm font-medium mb-3 ${
                  result().summary.skipped === 0 ? "text-green-600 dark:text-green-400" : "text-yellow-600 dark:text-yellow-400"
                }`}>
                  Created {result().summary.created} of {result().summary.total} invites
                  {result().summary.skipped > 0 && ` (${result().summary.skipped} skipped)`}
                </div>

                {/* Created list */}
                <Show when={result().created.length > 0}>
                  <div class="mb-4">
                    <div class="flex items-center justify-between mb-2">
                      <span class="text-sm font-medium text-gray-700 dark:text-gray-300">Created</span>
                      <button
                        class="btn-secondary btn-sm"
                        onClick={handleCopyAllTokens}
                      >
                        Copy All Tokens
                      </button>
                    </div>
                    <div class="border rounded-lg dark:border-gray-700 overflow-hidden">
                      <table class="w-full text-sm">
                        <thead>
                          <tr class="bg-gray-50 dark:bg-gray-800">
                            <th class="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Email</th>
                            <th class="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Token</th>
                            <th class="px-3 py-2 w-16"></th>
                          </tr>
                        </thead>
                        <tbody>
                          <For each={result().created}>
                            {(item) => (
                              <tr class="border-t dark:border-gray-700">
                                <td class="px-3 py-2 text-gray-900 dark:text-gray-100">{item.email}</td>
                                <td class="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-400 max-w-[200px] truncate">{item.token}</td>
                                <td class="px-3 py-2">
                                  <button
                                    class="btn-secondary btn-sm"
                                    style="white-space: nowrap"
                                    onClick={() => handleCopyBulkToken(item)}
                                  >
                                    {copiedTokens().has(item.email) ? "Copied!" : "Copy"}
                                  </button>
                                </td>
                              </tr>
                            )}
                          </For>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </Show>

                {/* Skipped list */}
                <Show when={result().skipped.length > 0}>
                  <div class="mb-4">
                    <span class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">Skipped</span>
                    <div class="border border-yellow-200 dark:border-yellow-800 rounded-lg overflow-hidden">
                      <table class="w-full text-sm">
                        <thead>
                          <tr class="bg-yellow-50 dark:bg-yellow-900/30">
                            <th class="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Email</th>
                            <th class="text-left px-3 py-2 font-medium text-gray-600 dark:text-gray-400">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          <For each={result().skipped}>
                            {(item) => (
                              <tr class="border-t border-yellow-200 dark:border-yellow-800">
                                <td class="px-3 py-2 text-gray-900 dark:text-gray-100">{item.email}</td>
                                <td class="px-3 py-2 text-yellow-700 dark:text-yellow-400 text-xs">{item.reason}</td>
                              </tr>
                            )}
                          </For>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </Show>

                <div class="flex justify-end gap-2 mt-4">
                  <button
                    class="btn-primary"
                    onClick={() => setBulkOpen(false)}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </Show>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget() !== null}
        title="Revoke Invite"
        message="Are you sure you want to revoke this invite? The token will no longer be valid."
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
