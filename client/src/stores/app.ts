import { createSignal } from "solid-js";

const APP_KEY = "rocket_client_selected_app";
const FIXED_APP = (import.meta.env.VITE_FIXED_APP as string) || null;

const [selectedApp, setSelectedAppSignal] = createSignal<string | null>(
  FIXED_APP || localStorage.getItem(APP_KEY)
);

export { selectedApp };

export function isFixedApp(): boolean {
  return FIXED_APP !== null;
}

export function getSelectedApp(): string | null {
  return selectedApp();
}

export function setSelectedApp(appName: string | null): void {
  if (FIXED_APP) return;
  if (appName) {
    localStorage.setItem(APP_KEY, appName);
  } else {
    localStorage.removeItem(APP_KEY);
  }
  setSelectedAppSignal(appName);
}
