import { Show, type ParentProps } from "solid-js";
import { Portal } from "solid-js/web";

interface ModalProps extends ParentProps {
  open: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
}

export default function Modal(props: ModalProps) {
  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      props.onClose();
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      props.onClose();
    }
  }

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="modal-overlay"
          onClick={handleOverlayClick}
          onKeyDown={handleKeyDown}
          tabIndex={-1}
          ref={(el) => el.focus()}
        >
          <div
            class={`modal-panel ${props.wide ? "modal-panel-wide" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="modal-header">
              <h2 class="modal-title">{props.title}</h2>
              <button class="modal-close" onClick={props.onClose}>
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  style={{ width: "20px", height: "20px" }}
                >
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            </div>
            <div class="modal-body">{props.children}</div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
