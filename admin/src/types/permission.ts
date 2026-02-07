export interface PermissionCondition {
  field: string;
  operator: string;
  value: any;
}

export interface PermissionRow {
  id: string;
  entity: string;
  action: string;
  roles: string[];
  conditions: PermissionCondition[] | string;
  created_at: string;
  updated_at: string;
}

export interface PermissionPayload {
  id?: string;
  entity: string;
  action: string;
  roles: string[];
  conditions: PermissionCondition[];
}

export function parseConditions(row: PermissionRow): PermissionCondition[] {
  if (typeof row.conditions === "string") {
    try {
      return JSON.parse(row.conditions);
    } catch {
      return [];
    }
  }
  return row.conditions ?? [];
}

export function emptyPermission(): PermissionPayload {
  return {
    entity: "",
    action: "read",
    roles: [],
    conditions: [],
  };
}
