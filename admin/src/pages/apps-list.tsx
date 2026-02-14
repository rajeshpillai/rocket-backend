import { createSignal, onMount, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { listApps, createApp, deleteApp } from "../api/platform";
import { setSelectedApp } from "../stores/app";
import { addToast } from "../stores/notifications";
import { isApiError } from "../types/api";
import type { AppInfo } from "../types/app";

export function AppsList() {
  const navigate = useNavigate();
  const [apps, setApps] = createSignal<AppInfo[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [showCreate, setShowCreate] = createSignal(false);
  const [name, setName] = createSignal("");
  const [displayName, setDisplayName] = createSignal("");
  const [dbDriver, setDbDriver] = createSignal("postgres");
  const [creating, setCreating] = createSignal(false);
  const [deleting, setDeleting] = createSignal<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const resp = await listApps();
      setApps(resp.data);
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  onMount(load);

  const handleSelect = (appName: string) => {
    setSelectedApp(appName);
    navigate("/entities", { replace: true });
  };

  const handleCreate = async (e: Event) => {
    e.preventDefault();
    setCreating(true);
    try {
      await createApp({ name: name(), display_name: displayName(), db_driver: dbDriver() });
      addToast("success", `App "${name()}" created`);
      setShowCreate(false);
      setName("");
      setDisplayName("");
      setDbDriver("postgres");
      load();
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to create app");
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (appName: string) => {
    if (!confirm(`Delete app "${appName}"? This will drop the database and cannot be undone.`)) {
      return;
    }
    setDeleting(appName);
    try {
      await deleteApp(appName);
      addToast("success", `App "${appName}" deleted`);
      load();
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to delete app");
      }
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      <div class="page-header">
        <h2 class="page-title">Apps</h2>
        <button class="btn-primary" onClick={() => setShowCreate(true)}>
          Create App
        </button>
      </div>

      <Show when={showCreate()}>
        <div class="card" style={{ "margin-bottom": "1.5rem" }}>
          <form onSubmit={handleCreate}>
            <div class="form-group">
              <label class="form-label" for="app-name">
                App Name (URL-safe slug)
              </label>
              <input
                id="app-name"
                class="form-input"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                placeholder="e.g. timesheet"
                pattern="^[a-z][a-z0-9_-]*$"
                required
              />
            </div>
            <div class="form-group">
              <label class="form-label" for="app-display">
                Display Name
              </label>
              <input
                id="app-display"
                class="form-input"
                value={displayName()}
                onInput={(e) => setDisplayName(e.currentTarget.value)}
                placeholder="e.g. Timesheet App"
                required
              />
            </div>
            <div class="form-group">
              <label class="form-label" for="app-driver">
                Database Driver
              </label>
              <select
                id="app-driver"
                class="form-input"
                value={dbDriver()}
                onChange={(e) => setDbDriver(e.currentTarget.value)}
              >
                <option value="postgres">PostgreSQL</option>
                <option value="sqlite">SQLite</option>
              </select>
              <p class="text-muted" style={{ "margin-top": "0.25rem", "font-size": "0.8rem" }}>
                {dbDriver() === "sqlite"
                  ? "SQLite: lightweight, file-based, zero infrastructure. Ideal for dev, demos, and small-scale."
                  : "PostgreSQL: full-featured, production-grade. Requires a running PostgreSQL server."}
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button type="submit" class="btn-primary" disabled={creating()}>
                {creating() ? "Creating..." : "Create"}
              </button>
              <button type="button" class="btn-secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </Show>

      <Show when={loading()}>
        <p class="text-muted">Loading apps...</p>
      </Show>

      <Show when={!loading() && apps().length === 0}>
        <div class="card">
          <p class="text-muted">No apps yet. Create one to get started.</p>
        </div>
      </Show>

      <Show when={!loading() && apps().length > 0}>
        <table class="data-table">
          <thead class="table-header">
            <tr>
              <th class="table-header-cell">Name</th>
              <th class="table-header-cell">Display Name</th>
              <th class="table-header-cell">Database</th>
              <th class="table-header-cell">Driver</th>
              <th class="table-header-cell">Status</th>
              <th class="table-header-cell">Created</th>
              <th class="table-header-cell">Actions</th>
            </tr>
          </thead>
          <tbody class="table-body">
            <For each={apps()}>
              {(app) => (
                <tr class="table-row">
                  <td class="table-cell">
                    <button
                      class="table-cell-link"
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
                      onClick={() => handleSelect(app.name)}
                    >
                      {app.name}
                    </button>
                  </td>
                  <td class="table-cell">{app.display_name}</td>
                  <td class="table-cell-mono">{app.db_name}</td>
                  <td class="table-cell">
                    <span class={`badge ${app.db_driver === "sqlite" ? "badge-info" : "badge-primary"}`}>
                      {app.db_driver === "sqlite" ? "SQLite" : "PostgreSQL"}
                    </span>
                  </td>
                  <td class="table-cell">
                    <span class={`badge ${app.status === "active" ? "badge-success" : "badge-warning"}`}>
                      {app.status}
                    </span>
                  </td>
                  <td class="table-cell">{new Date(app.created_at).toLocaleDateString()}</td>
                  <td class="table-cell-actions">
                    <div style={{ display: "flex", gap: "0.5rem", "justify-content": "flex-end" }}>
                      <button
                        class="btn-primary btn-sm"
                        onClick={() => handleSelect(app.name)}
                      >
                        Open
                      </button>
                      <button
                        class="btn-danger btn-sm"
                        onClick={() => handleDelete(app.name)}
                        disabled={deleting() === app.name}
                      >
                        {deleting() === app.name ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}
