import { createSignal, onMount, For, Show } from "solid-js";
import { A, useLocation, useNavigate } from "@solidjs/router";
import { clearAuth, getRefreshToken, parseTokenPayload } from "../stores/auth";
import { selectedApp, setSelectedApp } from "../stores/app";
import { platformLogout, listApps } from "../api/platform";
import type { AppInfo } from "../types/app";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: "\u25C8" },
  { href: "/entities", label: "Entities", icon: "\u25A1" },
  { href: "/relations", label: "Relations", icon: "\u21C4" },
  { href: "/erd", label: "ERD", icon: "\u2B21" },
  { href: "/rules", label: "Rules", icon: "\u2713" },
  { href: "/state-machines", label: "State Machines", icon: "\u21C6" },
  { href: "/workflows", label: "Workflows", icon: "\u27F3" },
  { href: "/workflow-monitor", label: "Workflow Monitor", icon: "\u25B6" },
  { href: "/data", label: "Data Browser", icon: "\u25A4" },
  { href: "/playground", label: "API Playground", icon: "\u25B7" },
  { href: "/users", label: "Users", icon: "\uD83D\uDC64" },
  { href: "/invites", label: "Invites", icon: "\u2709" },
  { href: "/permissions", label: "Permissions", icon: "\uD83D\uDD12" },
  { href: "/webhooks", label: "Webhooks", icon: "\uD83D\uDD17" },
  { href: "/webhook-logs", label: "Webhook Logs", icon: "\uD83D\uDCCB" },
  { href: "/ui-configs", label: "UI Configs", icon: "\uD83C\uDFA8" },
  { href: "/events", label: "Events", icon: "\u26A1" },
  { href: "/events/stats", label: "Event Stats", icon: "\uD83D\uDCCA" },
];

export const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [apps, setApps] = createSignal<AppInfo[]>([]);

  const isActive = (href: string) => location.pathname.startsWith(`/admin${href}`);

  const payload = () => parseTokenPayload();
  const userEmail = () => payload()?.sub ?? "";

  onMount(async () => {
    try {
      const resp = await listApps();
      setApps(resp.data);
    } catch {
      // Ignore — sidebar will show empty app list
    }
  });

  const handleAppChange = (e: Event) => {
    const value = (e.target as HTMLSelectElement).value;
    if (value === "__manage__") {
      setSelectedApp(null);
      navigate("/apps", { replace: true });
    } else if (value) {
      setSelectedApp(value);
      window.location.reload();
    }
  };

  const handleLogout = async () => {
    const refresh = getRefreshToken();
    if (refresh) {
      try {
        await platformLogout(refresh);
      } catch {
        // Ignore errors on logout
      }
    }
    clearAuth();
    setSelectedApp(null);
    navigate("/login", { replace: true });
  };

  return (
    <aside class={`sidebar ${sidebarCollapsed() ? "sidebar-collapsed" : ""}`}>
      <div class="sidebar-header">
        <Show when={!sidebarCollapsed()}>
          <div
            class="sidebar-title"
            onClick={() => { setSelectedApp(null); navigate("/apps", { replace: true }); }}
            title="Back to Apps"
          >
            Rocket Admin
          </div>
        </Show>
        <button
          class="sidebar-toggle"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed())}
          title={sidebarCollapsed() ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </div>

      <div class="sidebar-scroll-area">
        <Show when={!sidebarCollapsed()}>
          <div style={{ padding: "0 0.75rem 0.75rem" }}>
            <select
              class="form-input"
              style={{ "font-size": "0.85rem", "background-color": "#1f2937", color: "#f3f4f6", "border-color": "#4b5563" }}
              value={selectedApp() ?? ""}
              onChange={handleAppChange}
            >
              <option value="" disabled>
                Select app...
              </option>
              <For each={apps()}>
                {(app) => (
                  <option value={app.name}>{app.display_name || app.name}</option>
                )}
              </For>
              <option value="__manage__">Manage Apps...</option>
            </select>
          </div>
        </Show>

        <Show when={selectedApp()}>
          <Show when={!sidebarCollapsed()}>
            <div style={{ padding: "0 0.75rem 0.5rem", "font-size": "0.75rem", color: "var(--text-muted, #888)" }}>
              <span>Current app:</span>{" "}
              <strong style={{ color: "var(--text-primary, #e0e0e0)" }}>{selectedApp()}</strong>
            </div>
          </Show>
          <nav class="sidebar-nav">
            <For each={navItems}>
              {(item) => (
                <A
                  href={item.href}
                  class={`nav-link ${isActive(item.href) ? "nav-link-active" : ""}`}
                  title={sidebarCollapsed() ? item.label : undefined}
                >
                  <span>{item.icon}</span>
                  <Show when={!sidebarCollapsed()}>
                    <span>{item.label}</span>
                  </Show>
                </A>
              )}
            </For>
          </nav>
        </Show>

        <Show when={!selectedApp() && !sidebarCollapsed()}>
          <div style={{ padding: "1rem 0.75rem", color: "var(--text-muted, #888)" }}>
            Select an app to manage its resources.
          </div>
        </Show>

      </div>

      <div class="sidebar-footer">
        <Show when={!sidebarCollapsed()}>
          <div class="sidebar-user" title={userEmail()}>
            {userEmail()}
          </div>
          <button class="btn-secondary btn-sm sidebar-logout" onClick={handleLogout}>
            Logout
          </button>
        </Show>
        <Show when={sidebarCollapsed()}>
          <button
            class="btn-secondary btn-sm sidebar-logout"
            onClick={handleLogout}
            title="Logout"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </Show>
      </div>
    </aside>
  );
}
