import { createSignal, onMount, For, Show } from "solid-js";
import { A, useLocation, useNavigate } from "@solidjs/router";
import { clearAuth, getRefreshToken, parseTokenPayload } from "../stores/auth";
import { selectedApp, setSelectedApp } from "../stores/app";
import { platformLogout, listApps } from "../api/platform";
import type { AppInfo } from "../types/app";

const navItems = [
  { href: "/entities", label: "Entities", icon: "\u25A1" },
  { href: "/relations", label: "Relations", icon: "\u21C4" },
  { href: "/rules", label: "Rules", icon: "\u2713" },
  { href: "/state-machines", label: "State Machines", icon: "\u21C6" },
  { href: "/workflows", label: "Workflows", icon: "\u27F3" },
  { href: "/workflow-monitor", label: "Workflow Monitor", icon: "\u25B6" },
  { href: "/data", label: "Data Browser", icon: "\u25A4" },
  { href: "/users", label: "Users", icon: "\uD83D\uDC64" },
  { href: "/permissions", label: "Permissions", icon: "\uD83D\uDD12" },
  { href: "/webhooks", label: "Webhooks", icon: "\uD83D\uDD17" },
  { href: "/webhook-logs", label: "Webhook Logs", icon: "\uD83D\uDCCB" },
];

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
      navigate("/entities", { replace: true });
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
    <aside class="sidebar">
      <div class="sidebar-title">Rocket Admin</div>

      <div style={{ padding: "0 0.75rem 0.75rem" }}>
        <select
          class="form-input"
          style={{ "font-size": "0.85rem" }}
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

      <Show when={selectedApp()}>
        <nav class="sidebar-nav">
          <For each={navItems}>
            {(item) => (
              <A
                href={item.href}
                class={`nav-link ${isActive(item.href) ? "nav-link-active" : ""}`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </A>
            )}
          </For>
        </nav>
      </Show>

      <Show when={!selectedApp()}>
        <div style={{ padding: "1rem 0.75rem", color: "var(--text-muted, #888)" }}>
          Select an app to manage its resources.
        </div>
      </Show>

      <div class="sidebar-footer">
        <div class="sidebar-user" title={userEmail()}>
          {userEmail()}
        </div>
        <button class="btn-secondary btn-sm sidebar-logout" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </aside>
  );
}
