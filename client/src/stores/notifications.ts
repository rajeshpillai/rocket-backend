import { createSignal } from "solid-js";

export interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

const [toasts, setToasts] = createSignal<Toast[]>([]);

export { toasts };

export function addToast(type: Toast["type"], message: string): void {
  const id = crypto.randomUUID();
  setToasts((prev) => [...prev, { id, type, message }]);
  setTimeout(() => dismissToast(id), 4000);
}

export function dismissToast(id: string): void {
  setToasts((prev) => prev.filter((t) => t.id !== id));
}
