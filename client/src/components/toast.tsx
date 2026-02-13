import { For } from "solid-js";
import { toasts, dismissToast } from "../stores/notifications";

export default function ToastContainer() {
  return (
    <div class="toast-container">
      <For each={toasts()}>
        {(toast) => (
          <div
            class={`toast ${
              toast.type === "success"
                ? "toast-success"
                : toast.type === "error"
                  ? "toast-error"
                  : "toast-info"
            }`}
          >
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
