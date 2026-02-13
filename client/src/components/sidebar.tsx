import { createSignal, createEffect, For, Show } from "solid-js";
import { A, useLocation, useNavigate } from "@solidjs/router";
import { selectedApp, setSelectedApp } from "../stores/app";
import { clearAppAuth, parseAppTokenPayload } from "../stores/app-auth";
import { clearPlatformAuth } from "../stores/auth";
import { listEntities } from "../api/data";
import { parseDefinition, type EntityDefinition } from "../types/entity";
import { loadUIConfigs, getEntityUIConfig } from "../stores/ui-config";

export const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);

interface EntityNavItem {
  name: string;
  label: string;
  group: string;
}

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [entities, setEntities] = createSignal<EntityDefinition[]>([]);
  const [navItems, setNavItems] = createSignal<EntityNavItem[]>([]);

  createEffect(() => {
    if (selectedApp()) {
      loadEntities();
    }
  });

  async function loadEntities() {
    try {
      const rows = await listEntities();
      const defs = rows.map(parseDefinition);
      setEntities(defs);

      // Load UI configs for sidebar grouping/labels
      await loadUIConfigs();

      const items: EntityNavItem[] = defs.map((e) => {
        const uiConfig = getEntityUIConfig(e.name);
        return {
          name: e.name,
          label: uiConfig?.sidebar?.label || e.name,
          group: uiConfig?.sidebar?.group || "Data",
        };
      });
      setNavItems(items);
    } catch {
      setEntities([]);
      setNavItems([]);
    }
  }

  function getGroups(): string[] {
    const groups = new Set<string>();
    for (const item of navItems()) {
      groups.add(item.group);
    }
    return Array.from(groups);
  }

  function getGroupItems(group: string): EntityNavItem[] {
    return navItems().filter((item) => item.group === group);
  }

  function handleLogout() {
    clearAppAuth();
    clearPlatformAuth();
    setSelectedApp(null);
    navigate("/login");
  }

  function handleSwitchApp() {
    clearAppAuth();
    setSelectedApp(null);
    navigate("/apps");
  }

  function isActive(path: string): boolean {
    return location.pathname === path || location.pathname.startsWith(path + "/");
  }

  const userPayload = () => parseAppTokenPayload();

  return (
    <aside class={`sidebar ${sidebarCollapsed() ? "sidebar-collapsed" : ""}`}>
      <div class="sidebar-header">
        <Show when={!sidebarCollapsed()}>
          <div class="sidebar-logo" onClick={() => navigate("/dashboard")}>
            <div class="sidebar-logo-icon">R</div>
            <span class="sidebar-logo-text">Rocket</span>
          </div>
        </Show>
        <button
          class="sidebar-toggle"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed())}
          title={sidebarCollapsed() ? "Expand" : "Collapse"}
        >
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            style={{ width: "18px", height: "18px" }}
          >
            <Show
              when={!sidebarCollapsed()}
              fallback={
                <path
                  fill-rule="evenodd"
                  d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                  clip-rule="evenodd"
                />
              }
            >
              <path
                fill-rule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clip-rule="evenodd"
              />
            </Show>
          </svg>
        </button>
      </div>

      <div class="sidebar-scroll-area">
        <nav class="sidebar-nav">
          <Show when={!sidebarCollapsed()}>
            <div class="nav-section-label">Main</div>
          </Show>

          <A
            href="/dashboard"
            class={`nav-link ${isActive("/dashboard") ? "nav-link-active" : ""}`}
            title="Dashboard"
          >
            <svg class="nav-link-icon" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
            </svg>
            <Show when={!sidebarCollapsed()}>
              <span>Dashboard</span>
            </Show>
          </A>

          <Show when={navItems().length > 0}>
            <For each={getGroups()}>
              {(group) => (
                <>
                  <Show when={!sidebarCollapsed()}>
                    <div class="nav-section-label" style={{ "margin-top": "12px" }}>
                      {group}
                    </div>
                  </Show>

                  <For each={getGroupItems(group)}>
                    {(item) => (
                      <A
                        href={`/data/${item.name}`}
                        class={`nav-link ${isActive(`/data/${item.name}`) ? "nav-link-active" : ""}`}
                        title={item.label}
                      >
                        <svg
                          class="nav-link-icon"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fill-rule="evenodd"
                            d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                            clip-rule="evenodd"
                          />
                        </svg>
                        <Show when={!sidebarCollapsed()}>
                          <span>{item.label}</span>
                        </Show>
                      </A>
                    )}
                  </For>
                </>
              )}
            </For>
          </Show>
        </nav>
      </div>

      <div class="sidebar-footer">
        <Show when={selectedApp() && !sidebarCollapsed()}>
          <div class="sidebar-app-badge">{selectedApp()}</div>
        </Show>
        <Show when={userPayload() && !sidebarCollapsed()}>
          <div class="sidebar-user">{userPayload()?.sub}</div>
        </Show>
        <Show when={!sidebarCollapsed()}>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              class="btn-ghost btn-sm"
              style={{ flex: 1, "font-size": "12px" }}
              onClick={handleSwitchApp}
            >
              Switch App
            </button>
            <button
              class="btn-ghost btn-sm"
              style={{ flex: 1, "font-size": "12px" }}
              onClick={handleLogout}
            >
              Logout
            </button>
          </div>
        </Show>
        <Show when={sidebarCollapsed()}>
          <button
            class="btn-ghost btn-sm"
            onClick={handleLogout}
            title="Logout"
            style={{ "font-size": "12px" }}
          >
            ⏻
          </button>
        </Show>
      </div>
    </aside>
  );
}
