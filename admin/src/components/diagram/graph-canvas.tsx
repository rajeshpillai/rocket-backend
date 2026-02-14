import { createSignal, createEffect, For, onMount, onCleanup } from "solid-js";
import type { GraphLayout } from "./graph-layout";
import { GraphNode } from "./graph-node";
import { GraphEdge } from "./graph-edge";

interface GraphCanvasProps {
  layout: GraphLayout;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function GraphCanvas(props: GraphCanvasProps) {
  let svgRef: SVGSVGElement | undefined;
  const PADDING = 60;

  const [viewBox, setViewBox] = createSignal<ViewBox>({
    x: 0,
    y: 0,
    w: 800,
    h: 600,
  });
  const [isPanning, setIsPanning] = createSignal(false);
  const [panStart, setPanStart] = createSignal({ x: 0, y: 0 });
  const [vbStart, setVbStart] = createSignal({ x: 0, y: 0 });

  function fitToView() {
    const { width, height } = props.layout;
    if (width <= 0 || height <= 0) {
      setViewBox({ x: 0, y: 0, w: 800, h: 600 });
      return;
    }
    setViewBox({
      x: -PADDING,
      y: -PADDING,
      w: width + PADDING * 2,
      h: height + PADDING * 2,
    });
  }

  // Fit on layout change
  createEffect(() => {
    // Track layout reactively
    const _w = props.layout.width;
    const _h = props.layout.height;
    fitToView();
  });

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    if (!svgRef) return;
    const scale = e.deltaY > 0 ? 1.1 : 0.9;
    const vb = viewBox();
    const rect = svgRef.getBoundingClientRect();
    const cursorX = ((e.clientX - rect.left) / rect.width) * vb.w + vb.x;
    const cursorY = ((e.clientY - rect.top) / rect.height) * vb.h + vb.y;
    const newW = vb.w * scale;
    const newH = vb.h * scale;
    setViewBox({
      x: cursorX - (cursorX - vb.x) * scale,
      y: cursorY - (cursorY - vb.y) * scale,
      w: newW,
      h: newH,
    });
  }

  let didPan = false;

  function handleMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    didPan = false;
    setIsPanning(true);
    setPanStart({ x: e.clientX, y: e.clientY });
    setVbStart({ x: viewBox().x, y: viewBox().y });
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isPanning() || !svgRef) return;
    didPan = true;
    const rect = svgRef.getBoundingClientRect();
    const vb = viewBox();
    const dx = ((e.clientX - panStart().x) / rect.width) * vb.w;
    const dy = ((e.clientY - panStart().y) / rect.height) * vb.h;
    setViewBox({
      ...vb,
      x: vbStart().x - dx,
      y: vbStart().y - dy,
    });
  }

  function handleMouseUp() {
    setIsPanning(false);
  }

  function handleSvgClick(e: MouseEvent) {
    // Only deselect if we didn't pan and click target is the svg background
    if (!didPan && e.target === svgRef) {
      props.onSelectNode(null);
    }
  }

  onMount(() => {
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousemove", handleMouseMove);
    // Attach wheel handler as non-passive so preventDefault() works
    if (svgRef) {
      svgRef.addEventListener("wheel", handleWheel, { passive: false });
    }
  });

  onCleanup(() => {
    document.removeEventListener("mouseup", handleMouseUp);
    document.removeEventListener("mousemove", handleMouseMove);
    if (svgRef) {
      svgRef.removeEventListener("wheel", handleWheel);
    }
  });

  const vbString = () => {
    const vb = viewBox();
    return `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
  };

  return (
    <div class="diagram-canvas-wrap">
      <div class="diagram-toolbar">
        <button onClick={fitToView}>Fit</button>
        <button onClick={() => {
          const vb = viewBox();
          setViewBox({ ...vb, w: vb.w * 0.8, h: vb.h * 0.8 });
        }}>+</button>
        <button onClick={() => {
          const vb = viewBox();
          setViewBox({ ...vb, w: vb.w * 1.25, h: vb.h * 1.25 });
        }}>-</button>
      </div>
      <svg
        ref={svgRef}
        viewBox={vbString()}
        onClick={handleSvgClick}
        onMouseDown={handleMouseDown}
      >
        <defs>
          <marker
            id="arrowhead"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
        </defs>

        {/* Edges behind nodes */}
        <For each={props.layout.edges}>
          {(edge) => <GraphEdge edge={edge} />}
        </For>

        {/* Nodes */}
        <For each={props.layout.nodes}>
          {(node) => (
            <GraphNode
              node={node}
              selected={props.selectedNodeId === node.id}
              onClick={() => props.onSelectNode(node.id)}
            />
          )}
        </For>
      </svg>
    </div>
  );
}
