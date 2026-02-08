import { A } from "@solidjs/router";
import { sidebarCollapsed } from "./sidebar";

export function StatusBar() {
  return (
    <footer class={`status-bar ${sidebarCollapsed() ? "status-bar-collapsed" : ""}`}>
      <span class="status-bar-version">Rocket Admin v{__APP_VERSION__}</span>
      <A href="/help" class="status-bar-help" title="Help & Documentation">?</A>
    </footer>
  );
}
