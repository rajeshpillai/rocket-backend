export interface PermissionCondition {
  field: string;
  operator: string;
  value: any;
}

export interface Permission {
  id?: string;
  entity: string;
  action: string;
  roles: string[];
  conditions?: PermissionCondition[];
}
