import { createSignal } from "solid-js";
import { listEntities } from "../api/entities";
import type { EntityRow, EntityDefinition } from "../types/entity";
import { parseDefinition } from "../types/entity";

const [entities, setEntities] = createSignal<EntityRow[]>([]);
const [loading, setLoading] = createSignal(false);

async function load() {
  setLoading(true);
  try {
    const res = await listEntities();
    setEntities(res.data);
  } finally {
    setLoading(false);
  }
}

function parsed(): EntityDefinition[] {
  return entities().map(parseDefinition);
}

function entityNames(): string[] {
  return entities().map((e) => e.name);
}

export function useEntities() {
  return { entities, loading, load, parsed, entityNames };
}
