import { createSignal, onMount, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { listApps } from "../api/platform";
import { setSelectedApp } from "../stores/app";
import { clearAppAuth } from "../stores/app-auth";
import { clearPlatformAuth } from "../stores/auth";
import { addToast } from "../stores/notifications";
import { isApiError } from "../types/api";
import type { AppInfo } from "../types/app";
import ToastContainer from "../components/toast";

export default function AppsPage() {
  const navigate = useNavigate();
  const [apps, setApps] = createSignal<AppInfo[]>([]);
  const [loading, setLoading] = createSignal(true);

  onMount(() => {
    loadApps();
  });

  async function loadApps() {
    setLoading(true);
    try {
      const result = await listApps();
      setApps(result);
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to load apps");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleSelectApp(app: AppInfo) {
    clearAppAuth();
    setSelectedApp(app.name);
    navigate("/app-login");
  }

  function handleLogout() {
    clearPlatformAuth();
    clearAppAuth();
    setSelectedApp(null);
    navigate("/login");
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString();
  }

  return (
    <div class="login-container">
      <div class="login-card" style={{ "max-width": "600px" }}>
        <div class="login-logo">
          <div class="login-logo-icon">R</div>
          <span class="login-logo-text">Rocket</span>
        </div>

        <h1 class="login-title">Select an App</h1>
        <p class="login-subtitle">Choose which application to work with</p>

        <Show when={loading()}>
          <div class="loading-spinner">
            <div class="spinner" />
          </div>
        </Show>

        <Show when={!loading()}>
          <Show
            when={apps().length > 0}
            fallback={
              <div class="empty-state" style={{ "padding-top": "2rem", "padding-bottom": "2rem" }}>
                <div class="empty-state-title">No apps available</div>
                <div class="empty-state-text">
                  Create an app using the admin UI or API first.
                </div>
              </div>
            }
          >
            <div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
              <For each={apps()}>
                {(app) => (
                  <div
                    class="app-card"
                    onClick={() => handleSelectApp(app)}
                  >
                    <div class="app-card-name">{app.display_name || app.name}</div>
                    <div class="app-card-display">{app.name}</div>
                    <div class="app-card-meta">
                      <span class="badge badge-green">{app.status}</span>
                      <span style={{ "margin-left": "8px" }}>
                        Created {formatDate(app.created_at)}
                      </span>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <div style={{ "margin-top": "20px", "text-align": "center" }}>
            <button class="btn-ghost btn-sm" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </Show>
      </div>
      <ToastContainer />
    </div>
  );
}
