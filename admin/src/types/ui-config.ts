export interface UIConfigRow {
  id: string;
  entity: string;
  scope: string;
  config: Record<string, unknown> | string;
  created_at: string;
  updated_at: string;
}

export interface UIConfigPayload {
  entity: string;
  scope: string;
  config: Record<string, unknown>;
}

export function parseConfig(row: UIConfigRow): Record<string, unknown> {
  if (typeof row.config === "string") {
    try {
      return JSON.parse(row.config);
    } catch {
      return {};
    }
  }
  return row.config ?? {};
}

export function emptyUIConfig(): UIConfigPayload {
  return {
    entity: "",
    scope: "default",
    config: {},
  };
}
