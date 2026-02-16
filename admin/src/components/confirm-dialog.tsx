import { Show } from "solid-js";
import { Portal } from "solid-js/web";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  return (
    <Show when={props.open}>
      <Portal>
        <div class="modal-overlay" onClick={() => props.onCancel()}>
          <div class="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div class="modal-header">
              <h2 class="modal-title">{props.title}</h2>
            </div>
            <div class="modal-body">
              <p class="text-sm text-gray-600 dark:text-gray-400">{props.message}</p>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary" onClick={() => props.onCancel()}>
                Cancel
              </button>
              <button class={props.confirmVariant === "primary" ? "btn-primary" : "btn-danger"} onClick={() => props.onConfirm()}>
                {props.confirmLabel ?? "Delete"}
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
