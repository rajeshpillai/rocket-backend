import { createSignal, createMemo, Show, For, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { listEntities } from "../api/entities";
import { listRelations } from "../api/relations";
import { parseDefinition, type EntityDefinition, type Field, type PrimaryKey } from "../types/entity";
import { parseRelationDefinition, type RelationDefinition } from "../types/relation";
import { layoutERD, type LayoutNode } from "../components/diagram/graph-layout";
import { GraphCanvas } from "../components/diagram/graph-canvas";

export function ERD() {
  const navigate = useNavigate();
  const [entities, setEntities] = createSignal<EntityDefinition[]>([]);
  const [relations, setRelations] = createSignal<RelationDefinition[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const [entRes, relRes] = await Promise.all([
        listEntities(),
        listRelations(),
      ]);
      setEntities(entRes.data.map(parseDefinition));
      setRelations(relRes.data.map(parseRelationDefinition));
    } finally {
      setLoading(false);
    }
  });

  const layout = createMemo(() => layoutERD(entities(), relations()));

  const selectedEntity = createMemo((): EntityDefinition | null => {
    const id = selectedNodeId();
    if (!id) return null;
    return entities().find((e) => e.name === id) ?? null;
  });

  const relationsForEntity = createMemo(() => {
    const id = selectedNodeId();
    if (!id) return [];
    return relations().filter((r) => r.source === id || r.target === id);
  });

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">Entity Relationship Diagram</h1>
          <p class="page-subtitle">
            Visual overview of entities and their relationships
          </p>
        </div>
      </div>

      <Show
        when={!loading()}
        fallback={<p class="text-sm text-gray-500 p-4">Loading...</p>}
      >
        <Show
          when={entities().length > 0}
          fallback={
            <div class="diagram-empty" style="height: 400px;">
              <p>No entities defined yet. Create entities to see the ERD.</p>
            </div>
          }
        >
          <div class="diagram-container" style="height: calc(100vh - 180px);">
            <GraphCanvas
              layout={layout()}
              selectedNodeId={selectedNodeId()}
              onSelectNode={setSelectedNodeId}
            />
            <Show when={selectedEntity()}>
              <ERDDetailPanel
                entity={selectedEntity()!}
                relations={relationsForEntity()}
                onClose={() => setSelectedNodeId(null)}
                onEdit={() => navigate(`/entities/${selectedEntity()!.name}`)}
              />
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}

// --- Detail Panel ---

interface ERDDetailPanelProps {
  entity: EntityDefinition;
  relations: RelationDefinition[];
  onClose: () => void;
  onEdit: () => void;
}

function ERDDetailPanel(props: ERDDetailPanelProps) {
  return (
    <div class="diagram-property-panel">
      <div class="diagram-property-header">
        <span class="diagram-property-title">{props.entity.name}</span>
        <button class="diagram-property-close" onClick={props.onClose}>
          &times;
        </button>
      </div>

      {/* Primary Key */}
      <div class="diagram-property-section">
        <span class="diagram-property-label">Primary Key</span>
        <div class="erd-field-row">
          <span class="erd-field-name">
            {"\uD83D\uDD11"} {props.entity.primary_key.field}
          </span>
          <span class="erd-field-type">{props.entity.primary_key.type}</span>
        </div>
        <Show when={props.entity.primary_key.generated}>
          <span class="text-[10px] text-gray-400">auto-generated</span>
        </Show>
      </div>

      {/* Fields */}
      <div class="diagram-property-section">
        <span class="diagram-property-label">
          Fields ({props.entity.fields.length})
        </span>
        <div class="erd-field-list">
          <For each={props.entity.fields}>
            {(field) => (
              <div class="erd-field-row">
                <span class="erd-field-name">
                  {field.name}
                  {field.required ? " *" : ""}
                </span>
                <div class="flex items-center gap-1">
                  <Show when={field.unique}>
                    <span class="erd-field-badge">unique</span>
                  </Show>
                  <Show when={field.enum}>
                    <span class="erd-field-badge">enum</span>
                  </Show>
                  <span class="erd-field-type">{field.type}</span>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>

      {/* Soft Delete */}
      <Show when={props.entity.soft_delete}>
        <div class="diagram-property-section">
          <span class="text-[10px] text-gray-400">Soft delete enabled</span>
        </div>
      </Show>

      {/* Relations */}
      <Show when={props.relations.length > 0}>
        <div class="diagram-property-section">
          <span class="diagram-property-label">
            Relations ({props.relations.length})
          </span>
          <For each={props.relations}>
            {(rel) => {
              const isSource = rel.source === props.entity.name;
              const card =
                rel.type === "one_to_one"
                  ? "1:1"
                  : rel.type === "one_to_many"
                    ? "1:N"
                    : "N:N";
              return (
                <div class="erd-relation-item">
                  <span class="font-medium">{rel.name}</span>
                  <span class="text-gray-400 ml-1">({card})</span>
                  <br />
                  <span class="text-gray-400">
                    {isSource ? `${rel.source} \u2192 ${rel.target}` : `${rel.source} \u2192 ${rel.target}`}
                    {rel.source_key ? ` via ${rel.source_key}` : ""}
                  </span>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      {/* Edit button */}
      <button
        class="btn-secondary btn-sm w-full mt-2"
        onClick={props.onEdit}
      >
        Edit Entity
      </button>
    </div>
  );
}
