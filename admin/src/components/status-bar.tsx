import { A } from "@solidjs/router";
import { sidebarCollapsed } from "./sidebar";
import { theme, setTheme } from "../stores/theme";

const THEME_ORDER: Array<"light" | "system" | "dark"> = [
  "light",
  "system",
  "dark",
];

const THEME_ICON: Record<string, string> = {
  light: "\u2600",
  system: "\u25D1",
  dark: "\u263E",
};

export function StatusBar() {
  const cycleTheme = () => {
    const idx = THEME_ORDER.indexOf(theme());
    setTheme(THEME_ORDER[(idx + 1) % 3]);
  };

  return (
    <footer
      class={`status-bar ${sidebarCollapsed() ? "status-bar-collapsed" : ""}`}
    >
      <span class="status-bar-version">Rocket Admin v{__APP_VERSION__}</span>
      <div class="flex items-center gap-2">
        <button
          class="status-bar-help"
          onClick={cycleTheme}
          title={`Theme: ${theme()}`}
        >
          {THEME_ICON[theme()]}
        </button>
        <A href="/help" class="status-bar-help" title="Help & Documentation">
          ?
        </A>
      </div>
    </footer>
  );
}
