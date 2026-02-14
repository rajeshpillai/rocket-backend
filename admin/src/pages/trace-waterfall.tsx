import { createSignal, onMount, Show, For } from "solid-js";
import { useParams, useNavigate } from "@solidjs/router";
import { getTrace } from "../api/events";
import type { TraceNode } from "../types/event";
import { Badge } from "../components/badge";

const sourceColors: Record<string, "blue" | "green" | "red" | "gray" | "purple" | "yellow"> = {
  http: "blue",
  engine: "green",
  auth: "purple",
  webhook: "yellow",
  workflow: "blue",
  storage: "gray",
  db: "gray",
};

function SpanRow(props: {
  node: TraceNode;
  depth: number;
  totalMs: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const durationMs = () => props.node.duration_ms ?? 0;
  const widthPct = () => (props.totalMs > 0 ? (durationMs() / props.totalMs) * 100 : 0);
  const isSelected = () => props.selectedId === props.node.span_id;
  const statusColor = () => (props.node.status === "error" ? "red" : "green");
  const barColor = () => (props.node.status === "error" ? "#ef4444" : "var(--primary)");

  return (
    <>
      <div
        class="span-row"
        style={{
          "padding-left": `${props.depth * 24}px`,
          cursor: "pointer",
          "border-bottom": "1px solid var(--border-color, #e5e7eb)",
          padding: `8px 12px 8px ${props.depth * 24 + 12}px`,
          background: isSelected() ? "var(--bg-hover, rgba(59,130,246,0.06))" : "transparent",
        }}
        onClick={() => props.onSelect(props.node.span_id)}
      >
        <div style={{ display: "flex", "align-items": "center", gap: "8px", "flex-wrap": "wrap" }}>
          {/* Source badge */}
          <Badge
            label={props.node.source}
            color={sourceColors[props.node.source] ?? "gray"}
          />

          {/* Component + Action */}
          <span style={{ "font-weight": "500", "font-size": "0.875rem" }}>
            {props.node.component}
            <span style={{ color: "var(--text-muted, #6b7280)" }}> / </span>
            {props.node.action}
          </span>

          {/* Entity */}
          <Show when={props.node.entity}>
            <span style={{ "font-size": "0.75rem", color: "var(--text-muted, #6b7280)" }}>
              {props.node.entity}
            </span>
          </Show>

          {/* Status badge */}
          <Badge
            label={props.node.status ?? "unknown"}
            color={statusColor()}
          />
        </div>

        {/* Duration bar + text */}
        <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-top": "4px" }}>
          <div
            style={{
              flex: "1",
              height: "6px",
              "background-color": "var(--bg-secondary, #f3f4f6)",
              "border-radius": "3px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${widthPct()}%`,
                height: "100%",
                "background-color": barColor(),
                "border-radius": "3px",
                "min-width": widthPct() > 0 ? "2px" : "0",
              }}
            />
          </div>
          <span style={{ "font-size": "0.75rem", "font-family": "monospace", "white-space": "nowrap", color: "var(--text-muted, #6b7280)" }}>
            {durationMs().toFixed(2)}ms
          </span>
        </div>
      </div>

      {/* Expanded metadata panel */}
      <Show when={isSelected() && props.node.metadata}>
        <div
          style={{
            "padding-left": `${props.depth * 24 + 36}px`,
            "padding-right": "12px",
            "padding-top": "8px",
            "padding-bottom": "12px",
            "background-color": "var(--bg-secondary, #f9fafb)",
            "border-bottom": "1px solid var(--border-color, #e5e7eb)",
          }}
        >
          <div style={{ "font-size": "0.75rem", "font-weight": "600", "margin-bottom": "4px", color: "var(--text-muted, #6b7280)" }}>
            Metadata
          </div>
          <pre
            style={{
              "font-size": "0.75rem",
              "font-family": "monospace",
              "white-space": "pre-wrap",
              "word-break": "break-all",
              margin: "0",
              padding: "8px",
              "background-color": "var(--bg-code, #f3f4f6)",
              "border-radius": "4px",
              "max-height": "300px",
              "overflow-y": "auto",
            }}
          >
            {JSON.stringify(props.node.metadata, null, 2)}
          </pre>
        </div>
      </Show>

      {/* Recursively render children */}
      <For each={props.node.children}>
        {(child) => (
          <SpanRow
            node={child}
            depth={props.depth + 1}
            totalMs={props.totalMs}
            selectedId={props.selectedId}
            onSelect={props.onSelect}
          />
        )}
      </For>
    </>
  );
}

export function TraceWaterfall() {
  const params = useParams<{ traceId: string }>();
  const navigate = useNavigate();

  const [rootSpan, setRootSpan] = createSignal<TraceNode | null>(null);
  const [totalDurationMs, setTotalDurationMs] = createSignal(0);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const res = await getTrace(params.traceId);
      const trace = res.data;
      setRootSpan(trace.root_span);
      setTotalDurationMs(trace.total_duration_ms ?? 0);
      if (!trace.root_span) {
        setError("Trace has no spans.");
      }
    } catch (err: any) {
      if (err?.error?.message) {
        setError(err.error.message);
      } else {
        setError("Failed to load trace. It may not exist.");
      }
    } finally {
      setLoading(false);
    }
  });

  const handleSelect = (spanId: string) => {
    setSelectedSpanId((prev) => (prev === spanId ? null : spanId));
  };

  return (
    <div>
      <div class="page-header">
        <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
          <button class="btn-secondary btn-sm" onClick={() => navigate("/events")}>
            &larr; Back
          </button>
          <div>
            <h1 class="page-title" style={{ margin: "0" }}>
              Trace: {params.traceId.substring(0, 8)}
            </h1>
            <Show when={!loading() && !error()}>
              <p class="page-subtitle" style={{ margin: "0" }}>
                Total duration: {totalDurationMs().toFixed(2)}ms
              </p>
            </Show>
          </div>
        </div>
      </div>

      <Show when={loading()}>
        <p class="text-sm text-gray-500 dark:text-gray-400">Loading trace...</p>
      </Show>

      <Show when={!loading() && error()}>
        <div style={{
          padding: "24px",
          "text-align": "center",
          color: "var(--text-muted, #6b7280)",
        }}>
          <p style={{ "font-size": "1rem", "font-weight": "500", color: "#ef4444" }}>
            {error()}
          </p>
          <button class="btn-secondary" style={{ "margin-top": "12px" }} onClick={() => navigate("/events")}>
            Back to Events
          </button>
        </div>
      </Show>

      <Show when={!loading() && !error() && rootSpan()}>
        <div
          style={{
            border: "1px solid var(--border-color, #e5e7eb)",
            "border-radius": "8px",
            overflow: "hidden",
          }}
        >
          <SpanRow
            node={rootSpan()!}
            depth={0}
            totalMs={totalDurationMs()}
            selectedId={selectedSpanId()}
            onSelect={handleSelect}
          />
        </div>
      </Show>
    </div>
  );
}
