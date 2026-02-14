import { Show, type ParentProps, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";

interface ModalProps extends ParentProps {
  open: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
  fullscreen?: boolean;
}

export function Modal(props: ModalProps) {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") props.onClose();
  };

  onMount(() => document.addEventListener("keydown", handleKeyDown));
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown));

  const panelClass = () => {
    if (props.fullscreen) return "modal-panel-fullscreen";
    if (props.wide) return "modal-panel-wide";
    return "modal-panel";
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div class="modal-overlay" onClick={() => props.onClose()}>
          <div
            class={panelClass()}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="modal-header">
              <h2 class="modal-title">{props.title}</h2>
              <button class="modal-close" onClick={() => props.onClose()}>
                ✕
              </button>
            </div>
            <div class="modal-body">{props.children}</div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
