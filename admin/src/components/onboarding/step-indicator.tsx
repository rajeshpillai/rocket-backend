import { For } from "solid-js";

interface StepIndicatorProps {
  steps: string[];
  currentIndex: number;
}

export function StepIndicator(props: StepIndicatorProps) {
  return (
    <div class="step-indicator">
      <For each={props.steps}>
        {(_, i) => {
          const idx = i();
          const isCompleted = idx < props.currentIndex;
          const isActive = idx === props.currentIndex;
          return (
            <>
              {idx > 0 && (
                <div
                  class={`step-connector ${isCompleted ? "step-connector-completed" : ""}`}
                />
              )}
              <div
                class={`step-dot ${isActive ? "step-dot-active" : ""} ${isCompleted ? "step-dot-completed" : ""}`}
              />
            </>
          );
        }}
      </For>
    </div>
  );
}
