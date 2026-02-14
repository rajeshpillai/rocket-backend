import type { LayoutNode } from "./graph-layout";

interface GraphNodeProps {
  node: LayoutNode;
  selected: boolean;
  onClick: () => void;
}

const NODE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  action: { fill: "#eff6ff", stroke: "#3b82f6", text: "#1e40af" },
  condition: { fill: "#fefce8", stroke: "#eab308", text: "#854d0e" },
  approval: { fill: "#f0fdf4", stroke: "#22c55e", text: "#166534" },
  start: { fill: "#22c55e", stroke: "#16a34a", text: "#ffffff" },
  end: { fill: "#fecaca", stroke: "#ef4444", text: "#991b1b" },
  state: { fill: "#f1f5f9", stroke: "#64748b", text: "#1e293b" },
  initial: { fill: "#dbeafe", stroke: "#3b82f6", text: "#1e40af" },
};

const STEP_ICONS: Record<string, string> = {
  action: "\u26A1",
  condition: "\u2753",
  approval: "\u2714",
};

function ActionNode(props: { node: LayoutNode; colors: typeof NODE_COLORS.action; selected: boolean }) {
  const x = () => props.node.x - props.node.width / 2;
  const y = () => props.node.y - props.node.height / 2;
  return (
    <>
      <rect
        x={x()}
        y={y()}
        width={props.node.width}
        height={props.node.height}
        rx="8"
        fill={props.colors.fill}
        stroke={props.selected ? "#2563eb" : props.colors.stroke}
        stroke-width={props.selected ? 2.5 : 1.5}
      />
      <text
        x={props.node.x}
        y={props.node.y - 4}
        text-anchor="middle"
        fill={props.colors.text}
        font-size="13"
        font-weight="600"
      >
        {props.node.label}
      </text>
      <text
        x={props.node.x}
        y={props.node.y + 14}
        text-anchor="middle"
        fill="#94a3b8"
        font-size="10"
      >
        {STEP_ICONS[props.node.type] ?? ""} {props.node.type}
      </text>
    </>
  );
}

function ConditionNode(props: { node: LayoutNode; colors: typeof NODE_COLORS.condition; selected: boolean }) {
  const cx = () => props.node.x;
  const cy = () => props.node.y;
  const hw = () => props.node.width / 2;
  const hh = () => props.node.height / 2;
  const points = () =>
    `${cx()},${cy() - hh()} ${cx() + hw()},${cy()} ${cx()},${cy() + hh()} ${cx() - hw()},${cy()}`;

  return (
    <>
      <polygon
        points={points()}
        fill={props.colors.fill}
        stroke={props.selected ? "#2563eb" : props.colors.stroke}
        stroke-width={props.selected ? 2.5 : 1.5}
      />
      <text
        x={cx()}
        y={cy() - 4}
        text-anchor="middle"
        fill={props.colors.text}
        font-size="12"
        font-weight="600"
      >
        {props.node.label}
      </text>
      <text
        x={cx()}
        y={cy() + 12}
        text-anchor="middle"
        fill="#94a3b8"
        font-size="9"
      >
        condition
      </text>
    </>
  );
}

function CircleNode(props: { node: LayoutNode; colors: typeof NODE_COLORS.start; selected: boolean; double?: boolean }) {
  const r = () => props.node.width / 2;
  return (
    <>
      {props.double && (
        <circle
          cx={props.node.x}
          cy={props.node.y}
          r={r() + 3}
          fill="none"
          stroke={props.selected ? "#2563eb" : props.colors.stroke}
          stroke-width="1.5"
        />
      )}
      <circle
        cx={props.node.x}
        cy={props.node.y}
        r={r()}
        fill={props.colors.fill}
        stroke={props.selected ? "#2563eb" : props.colors.stroke}
        stroke-width={props.selected ? 2.5 : 1.5}
      />
      <text
        x={props.node.x}
        y={props.node.y + 4}
        text-anchor="middle"
        fill={props.colors.text}
        font-size="10"
        font-weight="600"
      >
        {props.node.label}
      </text>
    </>
  );
}

function StateNode(props: { node: LayoutNode; colors: typeof NODE_COLORS.state; selected: boolean; isInitial: boolean }) {
  const x = () => props.node.x - props.node.width / 2;
  const y = () => props.node.y - props.node.height / 2;
  return (
    <>
      <rect
        x={x()}
        y={y()}
        width={props.node.width}
        height={props.node.height}
        rx="20"
        fill={props.colors.fill}
        stroke={props.selected ? "#2563eb" : props.colors.stroke}
        stroke-width={props.selected ? 2.5 : props.isInitial ? 2.5 : 1.5}
      />
      <text
        x={props.node.x}
        y={props.node.y + 5}
        text-anchor="middle"
        fill={props.colors.text}
        font-size="13"
        font-weight={props.isInitial ? "700" : "500"}
      >
        {props.node.label}
      </text>
    </>
  );
}

export function GraphNode(props: GraphNodeProps) {
  const colors = () => NODE_COLORS[props.node.type] ?? NODE_COLORS.state;

  return (
    <g class="diagram-node" onClick={(e: MouseEvent) => { e.stopPropagation(); props.onClick(); }}>
      {props.node.type === "start" && (
        <CircleNode node={props.node} colors={colors()} selected={props.selected} />
      )}
      {props.node.type === "end" && (
        <CircleNode node={props.node} colors={colors()} selected={props.selected} double />
      )}
      {props.node.type === "condition" && (
        <ConditionNode node={props.node} colors={colors()} selected={props.selected} />
      )}
      {(props.node.type === "action" || props.node.type === "approval") && (
        <ActionNode node={props.node} colors={colors()} selected={props.selected} />
      )}
      {(props.node.type === "state" || props.node.type === "initial") && (
        <StateNode
          node={props.node}
          colors={colors()}
          selected={props.selected}
          isInitial={props.node.type === "initial"}
        />
      )}
    </g>
  );
}
