import { createSignal } from "solid-js";

export interface Toast {
  id: string;
  type: "success" | "error";
  message: string;
}

let nextId = 0;

const [toasts, setToasts] = createSignal<Toast[]>([]);

export function addToast(type: "success" | "error", message: string) {
  const id = String(++nextId);
  setToasts((prev) => [...prev, { id, type, message }]);
  setTimeout(() => dismissToast(id), 4000);
}

export function dismissToast(id: string) {
  setToasts((prev) => prev.filter((t) => t.id !== id));
}

export { toasts };
