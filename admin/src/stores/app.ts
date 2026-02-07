import { createSignal } from "solid-js";

const APP_KEY = "rocket_selected_app";

const [selectedApp, setSelectedAppSignal] = createSignal<string | null>(
  localStorage.getItem(APP_KEY),
);

export function getSelectedApp(): string | null {
  return selectedApp();
}

export function setSelectedApp(appName: string | null): void {
  if (appName) {
    localStorage.setItem(APP_KEY, appName);
  } else {
    localStorage.removeItem(APP_KEY);
  }
  setSelectedAppSignal(appName);
}

export { selectedApp };
