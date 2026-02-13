import { createSignal } from "solid-js";
import type { UIConfig, UIConfigRow } from "../types/ui-config";
import { listUIConfigs } from "../api/data";

const [configs, setConfigs] = createSignal<UIConfigRow[]>([]);
const [loaded, setLoaded] = createSignal(false);

export { configs, loaded as uiConfigsLoaded };

export async function loadUIConfigs(): Promise<void> {
  try {
    const rows = await listUIConfigs();
    setConfigs(rows);
  } catch {
    setConfigs([]);
  }
  setLoaded(true);
}

export function getEntityUIConfig(entity: string): UIConfig | null {
  const row = configs().find((c) => c.entity === entity);
  if (!row) return null;
  // config may come as string from JSONB
  if (typeof row.config === "string") {
    try {
      return JSON.parse(row.config);
    } catch {
      return null;
    }
  }
  return row.config;
}

export function getAllUIConfigs(): { entity: string; config: UIConfig }[] {
  return configs().map((row) => {
    let config: UIConfig;
    if (typeof row.config === "string") {
      try {
        config = JSON.parse(row.config);
      } catch {
        config = {} as UIConfig;
      }
    } else {
      config = row.config;
    }
    return { entity: row.entity, config };
  });
}
