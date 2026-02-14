import type { Rule } from "../metadata/rule.js";
import type { Registry } from "../metadata/registry.js";
import type { ErrorDetail } from "./errors.js";
import { getInstrumenter } from "../instrument/instrument.js";

/**
 * Evaluates all active rules for an entity/hook against the record.
 * Returns validation errors for field and expression rules.
 * Mutates the fields map for computed rules.
 */
export function evaluateRules(
  registry: Registry,
  entityName: string,
  hook: string,
  fields: Record<string, any>,
  old: Record<string, any>,
  isCreate: boolean,
): ErrorDetail[] {
  const span = getInstrumenter().startSpan("engine", "rules", "rules.evaluate");
  span.setEntity(entityName);
  span.setMetadata("hook", hook);
  try {
    const rules = registry.getRulesForEntity(entityName, hook);
    if (rules.length === 0) {
      span.setStatus("ok");
      span.setMetadata("rule_count", 0);
      return [];
    }

    const action = isCreate ? "create" : "update";
    const env = { record: fields, old, action };
    const errs: ErrorDetail[] = [];

    // 1. Field rules
    for (const r of rules) {
      if (r.type !== "field") continue;
      const detail = evaluateFieldRule(r, fields);
      if (detail) {
        errs.push(detail);
        if (r.definition.stop_on_fail) {
          span.setStatus("ok");
          span.setMetadata("rule_count", rules.length);
          span.setMetadata("error_count", errs.length);
          return errs;
        }
      }
    }

    // 2. Expression rules
    for (const r of rules) {
      if (r.type !== "expression") continue;
      const detail = evaluateExpressionRule(r, env);
      if (detail) {
        errs.push(detail);
        if (r.definition.stop_on_fail) {
          span.setStatus("ok");
          span.setMetadata("rule_count", rules.length);
          span.setMetadata("error_count", errs.length);
          return errs;
        }
      }
    }

    // If there are validation errors, don't run computed fields
    if (errs.length > 0) {
      span.setStatus("ok");
      span.setMetadata("rule_count", rules.length);
      span.setMetadata("error_count", errs.length);
      return errs;
    }

    // 3. Computed fields
    for (const r of rules) {
      if (r.type !== "computed") continue;
      try {
        const val = evaluateComputedField(r, env);
        fields[r.definition.field!] = val;
      } catch (err: any) {
        errs.push({
          field: r.definition.field,
          rule: "computed",
          message: err.message ?? String(err),
        });
      }
    }

    span.setStatus("ok");
    span.setMetadata("rule_count", rules.length);
    span.setMetadata("error_count", errs.length);
    return errs;
  } catch (err) {
    span.setStatus("error");
    span.setMetadata("error", (err as Error).message);
    throw err;
  } finally {
    span.end();
  }
}

/**
 * Evaluates a single field rule against a record.
 */
export function evaluateFieldRule(
  rule: Rule,
  record: Record<string, any>,
): ErrorDetail | null {
  const fieldName = rule.definition.field!;
  const val = record[fieldName];
  if (val === undefined || val === null) return null;

  const op = rule.definition.operator!;
  const msg =
    rule.definition.message ??
    `field ${fieldName} failed ${op} validation`;

  switch (op) {
    case "min": {
      const num = toNumber(val);
      const threshold = toNumber(rule.definition.value);
      if (num === null || threshold === null) return null;
      if (num < threshold) {
        return { field: fieldName, rule: "min", message: msg };
      }
      break;
    }
    case "max": {
      const num = toNumber(val);
      const threshold = toNumber(rule.definition.value);
      if (num === null || threshold === null) return null;
      if (num > threshold) {
        return { field: fieldName, rule: "max", message: msg };
      }
      break;
    }
    case "min_length": {
      if (typeof val !== "string") return null;
      const threshold = toNumber(rule.definition.value);
      if (threshold === null) return null;
      if (val.length < threshold) {
        return { field: fieldName, rule: "min_length", message: msg };
      }
      break;
    }
    case "max_length": {
      if (typeof val !== "string") return null;
      const threshold = toNumber(rule.definition.value);
      if (threshold === null) return null;
      if (val.length > threshold) {
        return { field: fieldName, rule: "max_length", message: msg };
      }
      break;
    }
    case "pattern": {
      if (typeof val !== "string") return null;
      const pattern = rule.definition.value;
      if (typeof pattern !== "string") return null;
      try {
        const re = new RegExp(pattern);
        if (!re.test(val)) {
          return { field: fieldName, rule: "pattern", message: msg };
        }
      } catch {
        return { field: fieldName, rule: "pattern", message: msg };
      }
      break;
    }
  }
  return null;
}

/**
 * Evaluates an expression rule against an environment.
 * Expression returning true = rule violated.
 */
export function evaluateExpressionRule(
  rule: Rule,
  env: Record<string, any>,
): ErrorDetail | null {
  const expression = rule.definition.expression;
  if (!expression) return null;

  try {
    // Simple expression evaluator using Function constructor
    // Environment variables are passed as named params
    const fn = compileExpression(rule, expression);
    const result = fn(env);

    if (result === true) {
      const msg = rule.definition.message ?? "Expression rule violated";
      return { rule: "expression", message: msg };
    }
  } catch (err: any) {
    return {
      rule: "expression",
      message: `rule evaluation error: ${err.message ?? err}`,
    };
  }
  return null;
}

/**
 * Evaluates a computed field expression and returns the computed value.
 */
export function evaluateComputedField(
  rule: Rule,
  env: Record<string, any>,
): any {
  const expression = rule.definition.expression;
  if (!expression) throw new Error("computed rule has no expression");

  const fn = compileComputedExpression(rule, expression);
  return fn(env);
}

// --- Expression compilation with caching ---

function compileExpression(
  rule: Rule,
  expression: string,
): (env: Record<string, any>) => boolean {
  if (rule.compiled) return rule.compiled as (env: Record<string, any>) => boolean;

  const fn = new Function(
    "env",
    `with (env) { return !!(${expression}); }`,
  ) as (env: Record<string, any>) => boolean;
  rule.compiled = fn;
  return fn;
}

function compileComputedExpression(
  rule: Rule,
  expression: string,
): (env: Record<string, any>) => any {
  if (rule.compiled) return rule.compiled as (env: Record<string, any>) => any;

  const fn = new Function(
    "env",
    `with (env) { return (${expression}); }`,
  ) as (env: Record<string, any>) => any;
  rule.compiled = fn;
  return fn;
}

function toNumber(v: any): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return isNaN(n) ? null : n;
  }
  return null;
}
