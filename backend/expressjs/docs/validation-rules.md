# Express Implementation — Validation Rules (Phase 1)

## Overview

Phase 1 adds a `_rules` system table and a three-tier validation engine that runs inside the write transaction. Rules are defined as JSON metadata via the admin API and evaluated before every INSERT/UPDATE. Mirrors the Go implementation exactly in API behavior.

## System Table

Same DDL as Go — shared Postgres database:

```sql
CREATE TABLE IF NOT EXISTS _rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity      TEXT NOT NULL REFERENCES _entities(name) ON DELETE CASCADE,
    hook        TEXT NOT NULL DEFAULT 'before_write',
    type        TEXT NOT NULL,           -- 'field', 'expression', 'computed'
    definition  JSONB NOT NULL,
    priority    INT NOT NULL DEFAULT 0,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

## Rule Types

### Field Rules

Simple per-field checks using operators.

```json
{
  "field": "total",
  "operator": "min",
  "value": 0,
  "message": "Total must be non-negative"
}
```

**Operators:**

| Operator | Type | Check |
|----------|------|-------|
| `min` | numeric | `value >= threshold` |
| `max` | numeric | `value <= threshold` |
| `min_length` | string | `value.length >= threshold` |
| `max_length` | string | `value.length <= threshold` |
| `pattern` | string | `new RegExp(pattern).test(value)` |

Absent or null/undefined fields pass field rules. Numeric comparison uses a `toNumber()` helper that handles both `number` and numeric `string` types.

### Expression Rules

Cross-field and conditional validation using JavaScript `Function` constructor.

```json
{
  "expression": "record.status == 'paid' && record.payment_date == nil",
  "message": "Payment date is required when status is paid",
  "stop_on_fail": true
}
```

**Expression semantics:** Returns `true` = rule **violated**, `false` = pass.

**Environment variables available:**

| Variable | Type | Description |
|----------|------|-------------|
| `record` | `Record<string, any>` | The incoming payload (fields being written) |
| `old` | `Record<string, any>` | Current DB state for updates, empty object for creates |
| `action` | `string` | `"create"` or `"update"` |

**Compilation:** Expressions are compiled to JavaScript functions using:

```typescript
new Function("env", `with (env) { return !!(${expression}); }`)
```

The `with` statement makes environment variables available as bare names in expressions (e.g., `record.status` instead of `env.record.status`). Compiled functions are cached on the `Rule.compiled` property for reuse.

**Go vs Express difference:** Go uses `expr-lang/expr` (compiles to bytecode, type-checked). Express uses `Function` constructor (JavaScript evaluation). Both produce identical behavior for the same expressions.

### Computed Fields

Expression rules that set a field value instead of validating.

```json
{
  "field": "total",
  "expression": "record.subtotal * (1 + record.tax_rate)"
}
```

Compiled with `new Function("env", "with (env) { return (${expression}); }")` (no `!!` coercion — returns the raw value). The result is set on `plan.fields[field]` before SQL execution.

## Execution Order

Within `executeWritePlan`, after BEGIN but before INSERT/UPDATE:

```
1. Field rules     — fast, no DB lookups
2. Expression rules — compiled function evaluation against env
3. Computed fields  — mutate plan.fields with computed values

If field/expression rules produce errors → ROLLBACK, throw validationError (422)
If stop_on_fail=true on any rule → short-circuit, return accumulated errors
Computed fields only run if validation passes
```

## Pipeline Integration

Rules are evaluated in `executeWritePlan()` (`nested-write.ts`):

```typescript
// Inside transaction, before INSERT/UPDATE
let old: Record<string, any> = {};
if (!plan.isCreate) {
  try { old = await fetchRecord(client, plan.entity, plan.id); } catch {}
}

const ruleErrs = evaluateRules(registry, plan.entity.name, "before_write", plan.fields, old, plan.isCreate);
if (ruleErrs.length > 0) {
  throw validationError(ruleErrs);
}
```

The thrown `AppError` is caught by the Express error middleware and serialized to the standard error JSON format.

## Admin API

```
GET    /api/_admin/rules           — list all rules
GET    /api/_admin/rules/:id       — get rule by UUID
POST   /api/_admin/rules           — create rule (returns 201 with generated ID)
PUT    /api/_admin/rules/:id       — update rule
DELETE /api/_admin/rules/:id       — delete rule
```

Validation on create/update:
- `entity` must exist in registry
- `hook` must be `before_write` or `before_delete`
- `type` must be `field`, `expression`, or `computed`

After every mutation, `reload()` refreshes the in-memory registry.

## Key Files

| File | Purpose |
|------|---------|
| `src/metadata/rule.ts` | `Rule`, `RuleDefinition`, `RelatedLoadSpec` interfaces |
| `src/metadata/registry.ts` | `getRulesForEntity()`, `loadRules()` |
| `src/metadata/loader.ts` | `loadRules()` from `_rules` table |
| `src/engine/rules.ts` | `evaluateRules()`, `evaluateFieldRule()`, `evaluateExpressionRule()`, `evaluateComputedField()` |
| `src/admin/handler.ts` | `listRules`, `getRule`, `createRule`, `updateRule`, `deleteRule` |
| `src/engine/nested-write.ts` | `executeWritePlan()` — rules wired before SQL write |

## Tests

**Integration tests** (requires Postgres):
- `field rule enforcement` — Create entity + field rule, verify 422 on violation, 201 on pass
- `computed field enforcement` — Create entity + computed rule, verify computed value in response
- `rules CRUD` — Full admin API lifecycle (create, list, get, update, delete, verify 404)
