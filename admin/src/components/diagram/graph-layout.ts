import dagre from "@dagrejs/dagre";
import type { WorkflowPayload } from "../../types/workflow";
import { gotoDisplay } from "../../types/workflow";
import type { StateMachinePayload } from "../../types/state-machine";
import type { EntityDefinition } from "../../types/entity";
import type { RelationDefinition } from "../../types/relation";

export interface LayoutNode {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data: Record<string, unknown>;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  points: Array<{ x: number; y: number }>;
}

export interface GraphLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

const NODE_DIMS: Record<string, { width: number; height: number }> = {
  action: { width: 180, height: 56 },
  condition: { width: 160, height: 80 },
  approval: { width: 180, height: 56 },
  start: { width: 36, height: 36 },
  end: { width: 36, height: 36 },
};

function resolveGoto(
  val: unknown,
  fallback: string,
): string {
  const display = gotoDisplay(val as any);
  if (!display) return fallback;
  if (display === "end") return "__end__";
  return display;
}

export function layoutWorkflow(wf: WorkflowPayload): GraphLayout {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    nodesep: 60,
    ranksep: 80,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Synthetic start node
  g.setNode("__start__", {
    label: "Start",
    width: NODE_DIMS.start.width,
    height: NODE_DIMS.start.height,
  });

  // Step nodes (skip steps with empty IDs)
  const validSteps = wf.steps.filter((s) => s.id);
  for (const step of validSteps) {
    const dims = NODE_DIMS[step.type] ?? NODE_DIMS.action;
    g.setNode(step.id, {
      label: step.id,
      width: Math.max(dims.width, step.id.length * 9 + 40),
      height: dims.height,
    });
  }

  // Synthetic end node
  g.setNode("__end__", {
    label: "End",
    width: NODE_DIMS.end.width,
    height: NODE_DIMS.end.height,
  });

  // Edges: start → first step
  if (validSteps.length > 0) {
    g.setEdge("__start__", validSteps[0].id);
  } else {
    g.setEdge("__start__", "__end__");
  }

  // Step edges
  for (let i = 0; i < validSteps.length; i++) {
    const step = validSteps[i];
    const nextDefault = i + 1 < validSteps.length ? validSteps[i + 1].id : "__end__";

    if (step.type === "action") {
      const target = resolveGoto(step.then, nextDefault);
      g.setEdge(step.id, target);
    } else if (step.type === "condition") {
      const trueTarget = resolveGoto(step.on_true, nextDefault);
      const falseTarget = resolveGoto(step.on_false, "__end__");
      if (trueTarget === falseTarget) {
        g.setEdge(step.id, trueTarget, { label: "true / false" });
      } else {
        g.setEdge(step.id, trueTarget, { label: "true" });
        g.setEdge(step.id, falseTarget, { label: "false" });
      }
    } else if (step.type === "approval") {
      // Collect targets and their labels, merging duplicates
      const targetLabels = new Map<string, string[]>();
      const approveTarget = resolveGoto(step.on_approve, nextDefault);
      const rejectTarget = resolveGoto(step.on_reject, "__end__");
      targetLabels.set(approveTarget, ["approve"]);
      if (targetLabels.has(rejectTarget)) {
        targetLabels.get(rejectTarget)!.push("reject");
      } else {
        targetLabels.set(rejectTarget, ["reject"]);
      }
      if (step.on_timeout) {
        const timeoutTarget = resolveGoto(step.on_timeout, "__end__");
        if (targetLabels.has(timeoutTarget)) {
          targetLabels.get(timeoutTarget)!.push("timeout");
        } else {
          targetLabels.set(timeoutTarget, ["timeout"]);
        }
      }
      for (const [target, labels] of targetLabels) {
        g.setEdge(step.id, target, { label: labels.join(" / ") });
      }
    }
  }

  dagre.layout(g);

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];

  for (const nodeId of g.nodes()) {
    const node = g.node(nodeId);
    if (!node) continue;
    const step = wf.steps.find((s) => s.id === nodeId);
    nodes.push({
      id: nodeId,
      label: node.label ?? nodeId,
      type: nodeId === "__start__"
        ? "start"
        : nodeId === "__end__"
          ? "end"
          : step?.type ?? "action",
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      data: step ? { ...step } : {},
    });
  }

  for (const edge of g.edges()) {
    const edgeData = g.edge(edge);
    if (!edgeData) continue;
    edges.push({
      id: `${edge.v}->${edge.w}`,
      source: edge.v,
      target: edge.w,
      label: edgeData.label as string | undefined,
      points: edgeData.points ?? [],
    });
  }

  const graphInfo = g.graph();

  return {
    nodes,
    edges,
    width: graphInfo?.width ?? 600,
    height: graphInfo?.height ?? 400,
  };
}

export function layoutStateMachine(sm: StateMachinePayload, extraStates?: string[]): GraphLayout {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: "LR",
    nodesep: 60,
    ranksep: 100,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Collect unique states
  const states = new Set<string>();
  if (sm.definition.initial) states.add(sm.definition.initial);
  for (const t of sm.definition.transitions) {
    const froms = Array.isArray(t.from) ? t.from : t.from ? [t.from] : [];
    for (const f of froms) {
      if (f) states.add(f);
    }
    if (t.to) states.add(t.to);
  }
  if (extraStates) {
    for (const s of extraStates) {
      if (s) states.add(s);
    }
  }

  // State nodes
  for (const state of states) {
    g.setNode(state, {
      label: state,
      width: Math.max(state.length * 10 + 40, 90),
      height: 46,
    });
  }

  // Transition edges
  for (let i = 0; i < sm.definition.transitions.length; i++) {
    const t = sm.definition.transitions[i];
    const froms = Array.isArray(t.from) ? t.from : t.from ? [t.from] : [];
    const label = t.guard
      ? t.guard.length > 25
        ? t.guard.slice(0, 25) + "..."
        : t.guard
      : t.roles?.length
        ? t.roles.join(", ")
        : "";

    for (const f of froms) {
      if (f && t.to) {
        g.setEdge(f, t.to, { label }, `t${i}_${f}`);
      }
    }
  }

  dagre.layout(g);

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];

  for (const nodeId of g.nodes()) {
    const node = g.node(nodeId);
    if (!node) continue;
    nodes.push({
      id: nodeId,
      label: node.label ?? nodeId,
      type: nodeId === sm.definition.initial ? "initial" : "state",
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      data: {},
    });
  }

  for (const edge of g.edges()) {
    const edgeData = g.edge(edge);
    if (!edgeData) continue;
    edges.push({
      id: edge.name ?? `${edge.v}->${edge.w}`,
      source: edge.v,
      target: edge.w,
      label: edgeData.label as string | undefined,
      points: edgeData.points ?? [],
    });
  }

  const graphInfo = g.graph();

  return {
    nodes,
    edges,
    width: graphInfo?.width ?? 600,
    height: graphInfo?.height ?? 400,
  };
}

// --- ERD Layout ---

const CARDINALITY: Record<string, string> = {
  one_to_one: "1:1",
  one_to_many: "1:N",
  many_to_many: "N:N",
};

const ERD_HEADER_HEIGHT = 30;
const ERD_ROW_HEIGHT = 22;
const ERD_PADDING = 8;
const ERD_CHAR_WIDTH = 7.5;
const ERD_MIN_WIDTH = 180;

export function layoutERD(
  entities: EntityDefinition[],
  relations: RelationDefinition[],
): GraphLayout {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    nodesep: 80,
    ranksep: 120,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const entity of entities) {
    const fieldCount = entity.fields.length + 1; // +1 for PK row
    const height = ERD_HEADER_HEIGHT + fieldCount * ERD_ROW_HEIGHT + ERD_PADDING * 2;

    let maxLen = entity.name.length;
    const pkLabel = `${entity.primary_key.field} : ${entity.primary_key.type}`;
    maxLen = Math.max(maxLen, pkLabel.length);
    for (const f of entity.fields) {
      const fieldLabel = `${f.name} : ${f.type}`;
      maxLen = Math.max(maxLen, fieldLabel.length);
    }
    const width = Math.max(ERD_MIN_WIDTH, maxLen * ERD_CHAR_WIDTH + 40);

    g.setNode(entity.name, {
      label: entity.name,
      width,
      height,
    });
  }

  for (const rel of relations) {
    if (g.hasNode(rel.source) && g.hasNode(rel.target)) {
      const card = CARDINALITY[rel.type] ?? rel.type;
      g.setEdge(rel.source, rel.target, {
        label: `${rel.name} (${card})`,
      });
    }
  }

  dagre.layout(g);

  const erdNodes: LayoutNode[] = [];
  const erdEdges: LayoutEdge[] = [];

  for (const nodeId of g.nodes()) {
    const node = g.node(nodeId);
    if (!node) continue;
    const entity = entities.find((e) => e.name === nodeId);
    erdNodes.push({
      id: nodeId,
      label: node.label ?? nodeId,
      type: "entity",
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      data: entity
        ? { fields: entity.fields, primaryKey: entity.primary_key, softDelete: entity.soft_delete }
        : {},
    });
  }

  for (const edge of g.edges()) {
    const edgeData = g.edge(edge);
    if (!edgeData) continue;
    erdEdges.push({
      id: `${edge.v}->${edge.w}`,
      source: edge.v,
      target: edge.w,
      label: edgeData.label as string | undefined,
      points: edgeData.points ?? [],
    });
  }

  const erdGraphInfo = g.graph();

  return {
    nodes: erdNodes,
    edges: erdEdges,
    width: erdGraphInfo?.width ?? 600,
    height: erdGraphInfo?.height ?? 400,
  };
}
