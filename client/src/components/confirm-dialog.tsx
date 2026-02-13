import { Show } from "solid-js";
import { Portal } from "solid-js/web";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog(props: ConfirmDialogProps) {
  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) props.onCancel();
          }}
        >
          <div
            class="modal-panel"
            style={{ "max-width": "400px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="modal-header">
              <h2 class="modal-title">{props.title}</h2>
            </div>
            <div class="modal-body">
              <p style={{ "font-size": "14px", color: "#4b5563" }}>
                {props.message}
              </p>
            </div>
            <div class="modal-footer">
              <button class="btn-secondary btn-sm" onClick={props.onCancel}>
                Cancel
              </button>
              <button class="btn-danger btn-sm" onClick={props.onConfirm}>
                {props.confirmLabel || "Delete"}
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
