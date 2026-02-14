import { createSignal } from "solid-js";

const THEME_KEY = "rocket_theme";
type Theme = "light" | "dark" | "system";

function getSystemPreference(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark" || stored === "system")
    return stored;
  return "system";
}

function resolve(t: Theme): "light" | "dark" {
  return t === "system" ? getSystemPreference() : t;
}

const [theme, setThemeSignal] = createSignal<Theme>(getStoredTheme());
const [resolvedTheme, setResolvedTheme] = createSignal<"light" | "dark">(
  resolve(getStoredTheme()),
);

function applyTheme(resolved: "light" | "dark"): void {
  setResolvedTheme(resolved);
  if (resolved === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

export function setTheme(t: Theme): void {
  localStorage.setItem(THEME_KEY, t);
  setThemeSignal(t);
  applyTheme(resolve(t));
}

// Apply on initial load
applyTheme(resolve(getStoredTheme()));

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (theme() === "system") {
      applyTheme(getSystemPreference());
    }
  });

export { theme, resolvedTheme };
