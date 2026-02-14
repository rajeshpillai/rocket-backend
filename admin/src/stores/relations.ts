import { createSignal } from "solid-js";
import { listRelations } from "../api/relations";
import type { RelationRow, RelationDefinition } from "../types/relation";
import { parseRelationDefinition } from "../types/relation";

const [relations, setRelations] = createSignal<RelationRow[]>([]);
const [loading, setLoading] = createSignal(false);

async function load() {
  setLoading(true);
  try {
    const res = await listRelations();
    setRelations(res.data);
  } finally {
    setLoading(false);
  }
}

function parsed(): RelationDefinition[] {
  return relations().map(parseRelationDefinition);
}

/** Get all relations where the given entity is the source (parent). */
function forSource(entityName: string): RelationDefinition[] {
  return parsed().filter((r) => r.source === entityName);
}

export function useRelations() {
  return { relations, loading, load, parsed, forSource };
}
