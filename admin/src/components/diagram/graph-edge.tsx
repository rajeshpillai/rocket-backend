import type { LayoutEdge } from "./graph-layout";

interface GraphEdgeProps {
  edge: LayoutEdge;
}

function buildPath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return "";
  const [first, ...rest] = points;
  let d = `M ${first.x} ${first.y}`;

  if (rest.length === 1) {
    d += ` L ${rest[0].x} ${rest[0].y}`;
  } else if (rest.length === 2) {
    // Quadratic curve through midpoint
    d += ` Q ${rest[0].x} ${rest[0].y} ${rest[1].x} ${rest[1].y}`;
  } else {
    // Smooth curve through all points
    for (let i = 0; i < rest.length - 1; i++) {
      const cp = rest[i];
      const end = {
        x: (rest[i].x + rest[i + 1].x) / 2,
        y: (rest[i].y + rest[i + 1].y) / 2,
      };
      d += ` Q ${cp.x} ${cp.y} ${end.x} ${end.y}`;
    }
    // Final segment to the last point
    const last = rest[rest.length - 1];
    d += ` L ${last.x} ${last.y}`;
  }

  return d;
}

function midpoint(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  const mid = Math.floor(points.length / 2);
  return points[mid];
}

export function GraphEdge(props: GraphEdgeProps) {
  const path = () => buildPath(props.edge.points);
  const labelPos = () => midpoint(props.edge.points);

  return (
    <g>
      <path
        d={path()}
        fill="none"
        stroke="#94a3b8"
        stroke-width="1.5"
        marker-end="url(#arrowhead)"
      />
      {props.edge.label && (
        <g>
          <rect
            x={labelPos().x - (props.edge.label.length * 3.5 + 6)}
            y={labelPos().y - 9}
            width={props.edge.label.length * 7 + 12}
            height={18}
            rx="4"
            fill="white"
            stroke="#e2e8f0"
            stroke-width="0.5"
          />
          <text
            x={labelPos().x}
            y={labelPos().y + 4}
            text-anchor="middle"
            class="diagram-edge-label"
          >
            {props.edge.label}
          </text>
        </g>
      )}
    </g>
  );
}
