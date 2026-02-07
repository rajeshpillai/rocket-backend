import type { UserContext } from "./auth.js";
import type { Registry } from "../metadata/registry.js";
import type { Permission, PermissionCondition } from "../metadata/permission.js";
import type { WhereClause } from "../engine/query.js";
import { AppError } from "../engine/errors.js";

export function checkPermission(
  user: UserContext | undefined,
  entity: string,
  action: string,
  registry: Registry,
  currentRecord: Record<string, any> | null,
): void {
  if (!user) {
    throw new AppError("UNAUTHORIZED", 401, "Authentication required");
  }

  // Admin bypasses all permission checks
  if (user.roles.includes("admin")) {
    return;
  }

  const policies = registry.getPermissions(entity, action);
  if (policies.length === 0) {
    throw new AppError(
      "FORBIDDEN",
      403,
      `No permission for ${action} on ${entity}`,
    );
  }

  // Check each policy — if ANY passes, the action is allowed
  for (const p of policies) {
    if (!hasRoleIntersection(user.roles, p.roles)) {
      continue;
    }
    // Role matches — now check conditions
    if (!p.conditions || p.conditions.length === 0) {
      return; // No conditions, role match is sufficient
    }
    if (currentRecord && evaluateConditions(p.conditions, currentRecord)) {
      return;
    }
    // For create, there's no current record — conditions don't apply
    if (!currentRecord && (action === "create" || action === "read")) {
      return;
    }
  }

  throw new AppError(
    "FORBIDDEN",
    403,
    `Permission denied for ${action} on ${entity}`,
  );
}

export function getReadFilters(
  user: UserContext | undefined,
  entity: string,
  registry: Registry,
): WhereClause[] {
  if (!user || user.roles.includes("admin")) {
    return [];
  }

  const policies = registry.getPermissions(entity, "read");
  if (policies.length === 0) {
    return [];
  }

  const filters: WhereClause[] = [];
  for (const p of policies) {
    if (!hasRoleIntersection(user.roles, p.roles)) {
      continue;
    }
    if (p.conditions) {
      for (const cond of p.conditions) {
        filters.push({
          field: cond.field,
          operator: cond.operator,
          value: cond.value,
        });
      }
    }
  }
  return filters;
}

function hasRoleIntersection(userRoles: string[], policyRoles: string[]): boolean {
  for (const ur of userRoles) {
    for (const pr of policyRoles) {
      if (ur.toLowerCase() === pr.toLowerCase()) {
        return true;
      }
    }
  }
  return false;
}

function evaluateConditions(
  conditions: PermissionCondition[],
  record: Record<string, any>,
): boolean {
  for (const cond of conditions) {
    const val = record[cond.field];
    if (val === undefined) return false;
    if (!evaluateCondition(cond.operator, val, cond.value)) {
      return false;
    }
  }
  return true;
}

function evaluateCondition(operator: string, recordVal: any, condVal: any): boolean {
  switch (operator) {
    case "eq":
      return String(recordVal) === String(condVal);
    case "neq":
      return String(recordVal) !== String(condVal);
    case "in":
      return valueInList(recordVal, condVal);
    case "not_in":
      return !valueInList(recordVal, condVal);
    case "gt":
      return compareNumeric(recordVal, condVal) > 0;
    case "gte":
      return compareNumeric(recordVal, condVal) >= 0;
    case "lt":
      return compareNumeric(recordVal, condVal) < 0;
    case "lte":
      return compareNumeric(recordVal, condVal) <= 0;
    default:
      return false;
  }
}

function valueInList(val: any, list: any): boolean {
  if (!Array.isArray(list)) return false;
  const valStr = String(val);
  return list.some((item) => String(item) === valStr);
}

function compareNumeric(a: any, b: any): number {
  const fa = Number(a) || 0;
  const fb = Number(b) || 0;
  return fa - fb;
}
