import { For } from "solid-js";
import { toasts, dismissToast } from "../stores/notifications";

export function ToastContainer() {
  return (
    <div class="toast-container">
      <For each={toasts()}>
        {(toast) => (
          <div class={toast.type === "success" ? "toast-success" : "toast-error"}>
            <span>{toast.message}</span>
            <button
              class="toast-dismiss"
              onClick={() => dismissToast(toast.id)}
            >
              ✕
            </button>
          </div>
        )}
      </For>
    </div>
  );
}
