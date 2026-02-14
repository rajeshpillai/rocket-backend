import { Show, For } from "solid-js";
import type { LayoutNode } from "./graph-layout";
import type { WorkflowStep, WorkflowAction } from "../../types/workflow";
import { gotoDisplay } from "../../types/workflow";

interface NodePropertyPanelProps {
  node: LayoutNode | null;
  onClose: () => void;
  mode: "workflow" | "state-machine";
}

function formatGoto(val: unknown): string {
  const display = gotoDisplay(val as any);
  return display || "(next)";
}

function ActionSummary(props: { action: WorkflowAction }) {
  return (
    <div class="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1.5 border border-gray-100">
      <span class="font-medium text-gray-800">{props.action.type}</span>
      <Show when={props.action.type === "set_field"}>
        {" "}&rarr; {props.action.entity}.{props.action.field} = {String(props.action.value ?? "")}
      </Show>
      <Show when={props.action.type === "webhook"}>
        {" "}&rarr; {props.action.method ?? "POST"} {props.action.url}
      </Show>
      <Show when={props.action.type === "send_event"}>
        {" "}&rarr; {props.action.event}
      </Show>
      <Show when={props.action.type === "create_record"}>
        {" "}&rarr; {props.action.entity}
      </Show>
    </div>
  );
}

function WorkflowNodeDetails(props: { step: WorkflowStep }) {
  return (
    <>
      <div class="diagram-property-section">
        <span class="diagram-property-label">Type</span>
        <span
          class="diagram-property-badge"
          style={{
            "background-color":
              props.step.type === "action" ? "#dbeafe" :
              props.step.type === "condition" ? "#fef9c3" :
              "#dcfce7",
            color:
              props.step.type === "action" ? "#1e40af" :
              props.step.type === "condition" ? "#854d0e" :
              "#166534",
          }}
        >
          {props.step.type}
        </span>
      </div>

      {/* Action step details */}
      <Show when={props.step.type === "action"}>
        <Show when={props.step.actions && props.step.actions.length > 0}>
          <div class="diagram-property-section">
            <span class="diagram-property-label">Actions ({props.step.actions!.length})</span>
            <div class="flex flex-col gap-1">
              <For each={props.step.actions}>
                {(action) => <ActionSummary action={action} />}
              </For>
            </div>
          </div>
        </Show>
        <div class="diagram-property-section">
          <span class="diagram-property-label">Then</span>
          <span class="diagram-property-value">{formatGoto(props.step.then)}</span>
        </div>
      </Show>

      {/* Condition step details */}
      <Show when={props.step.type === "condition"}>
        <div class="diagram-property-section">
          <span class="diagram-property-label">Expression</span>
          <span class="diagram-property-value">{props.step.expression ?? "(none)"}</span>
        </div>
        <div class="diagram-property-section">
          <span class="diagram-property-label">On True</span>
          <span class="diagram-property-value">{formatGoto(props.step.on_true)}</span>
        </div>
        <div class="diagram-property-section">
          <span class="diagram-property-label">On False</span>
          <span class="diagram-property-value">{formatGoto(props.step.on_false)}</span>
        </div>
      </Show>

      {/* Approval step details */}
      <Show when={props.step.type === "approval"}>
        <Show when={props.step.assignee}>
          <div class="diagram-property-section">
            <span class="diagram-property-label">Assignee</span>
            <span class="diagram-property-value">
              {props.step.assignee!.type}
              {props.step.assignee!.role ? `: ${props.step.assignee!.role}` : ""}
              {props.step.assignee!.user ? `: ${props.step.assignee!.user}` : ""}
              {props.step.assignee!.path ? `: ${props.step.assignee!.path}` : ""}
            </span>
          </div>
        </Show>
        <Show when={props.step.timeout}>
          <div class="diagram-property-section">
            <span class="diagram-property-label">Timeout</span>
            <span class="diagram-property-value">{props.step.timeout}</span>
          </div>
        </Show>
        <div class="diagram-property-section">
          <span class="diagram-property-label">On Approve</span>
          <span class="diagram-property-value">{formatGoto(props.step.on_approve)}</span>
        </div>
        <div class="diagram-property-section">
          <span class="diagram-property-label">On Reject</span>
          <span class="diagram-property-value">{formatGoto(props.step.on_reject)}</span>
        </div>
        <Show when={props.step.on_timeout}>
          <div class="diagram-property-section">
            <span class="diagram-property-label">On Timeout</span>
            <span class="diagram-property-value">{formatGoto(props.step.on_timeout)}</span>
          </div>
        </Show>
      </Show>
    </>
  );
}

function StateNodeDetails(props: { node: LayoutNode }) {
  return (
    <div class="diagram-property-section">
      <span class="diagram-property-label">Type</span>
      <span
        class="diagram-property-badge"
        style={{
          "background-color": props.node.type === "initial" ? "#dbeafe" : "#f1f5f9",
          color: props.node.type === "initial" ? "#1e40af" : "#475569",
        }}
      >
        {props.node.type === "initial" ? "initial state" : "state"}
      </span>
    </div>
  );
}

export function NodePropertyPanel(props: NodePropertyPanelProps) {
  const node = () => props.node;

  return (
    <Show when={node()}>
      <div class="diagram-property-panel">
        <div class="diagram-property-header">
          <span class="diagram-property-title">{node()!.label}</span>
          <button class="diagram-property-close" onClick={props.onClose}>
            ✕
          </button>
        </div>

        <Show when={props.mode === "workflow" && node()!.type !== "start" && node()!.type !== "end"}>
          <WorkflowNodeDetails step={node()!.data as unknown as WorkflowStep} />
        </Show>

        <Show when={props.mode === "workflow" && (node()!.type === "start" || node()!.type === "end")}>
          <div class="diagram-property-section">
            <span class="diagram-property-label">Type</span>
            <span class="diagram-property-badge" style={{
              "background-color": node()!.type === "start" ? "#dcfce7" : "#fecaca",
              color: node()!.type === "start" ? "#166534" : "#991b1b",
            }}>
              {node()!.type}
            </span>
          </div>
        </Show>

        <Show when={props.mode === "state-machine"}>
          <StateNodeDetails node={node()!} />
        </Show>
      </div>
    </Show>
  );
}
