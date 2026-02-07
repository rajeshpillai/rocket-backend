# Go Implementation — Validation Rules (Phase 1)

## Overview

Phase 1 adds a `_rules` system table and a three-tier validation engine that runs inside the write transaction. Rules are defined as JSON metadata via the admin API and evaluated before every INSERT/UPDATE.

## System Table

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

Simple per-field checks using operators. No DB lookups needed.

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
| `min_length` | string | `len(value) >= threshold` |
| `max_length` | string | `len(value) <= threshold` |
| `pattern` | string | `regexp.MatchString(pattern, value)` |

Absent or nil fields pass field rules (use `required` in entity field definition for presence checks).

Numeric comparison uses a `toFloat64()` helper that handles `float64`, `float32`, `int`, `int64`, `int32` — values from both JSON parsing and DB scans.

### Expression Rules

Cross-field and conditional validation using [expr-lang/expr](https://github.com/expr-lang/expr).

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
| `record` | `map[string]any` | The incoming payload (fields being written) |
| `old` | `map[string]any` | Current DB state for updates, empty map for creates |
| `action` | `string` | `"create"` or `"update"` |

**Compilation:** Expressions are compiled to `*vm.Program` bytecode using `expr.Compile()` with `expr.AsBool()`. Compilation happens lazily on first evaluation and is cached on the `Rule.Compiled` field.

### Computed Fields

Expression rules that set a field value instead of validating.

```json
{
  "field": "total",
  "expression": "record.subtotal * (1 + record.tax_rate)"
}
```

Compiled with `expr.Compile()` (no `AsBool()` — returns any type). The result is set on `plan.Fields[field]` before SQL execution.

## Execution Order

Within `ExecuteWritePlan`, after BEGIN but before INSERT/UPDATE:

```
1. Field rules     — fast, no DB lookups, all operators checked
2. Expression rules — compiled bytecode evaluation against env
3. Computed fields  — mutate plan.Fields with computed values

If field/expression rules produce errors → ROLLBACK, return 422
If stop_on_fail=true on any rule → short-circuit, return accumulated errors
Computed fields only run if validation passes (no errors from steps 1-2)
```

## Pipeline Integration

Rules are evaluated in `ExecuteWritePlan()` (`nested_write.go`):

```go
// Inside transaction, before INSERT/UPDATE
var old map[string]any
if !plan.IsCreate {
    old, _ = fetchRecord(ctx, tx, plan.Entity, plan.ID)
}
ruleErrs := EvaluateRules(reg, plan.Entity.Name, "before_write", plan.Fields, old, plan.IsCreate)
if len(ruleErrs) > 0 {
    return nil, ValidationError(ruleErrs)
}
```

The `ValidationError` is an `*AppError` with status 422 and field-level `ErrorDetail` entries. The error handler in the Fiber error middleware converts it to the standard error JSON format.

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

After every mutation, `metadata.Reload()` refreshes the in-memory registry.

## Key Files

| File | Purpose |
|------|---------|
| `internal/metadata/rule.go` | `Rule`, `RuleDefinition`, `RelatedLoadSpec` structs |
| `internal/metadata/registry.go` | `GetRulesForEntity()`, `LoadRules()` |
| `internal/metadata/loader.go` | `loadRules()` from `_rules` table |
| `internal/engine/rules.go` | `EvaluateRules()`, `EvaluateFieldRule()`, `EvaluateExpressionRule()`, `EvaluateComputedField()`, `CompileExpression()`, `CompileComputedExpression()` |
| `internal/admin/handler.go` | `ListRules`, `GetRule`, `CreateRule`, `UpdateRule`, `DeleteRule` |
| `internal/engine/nested_write.go` | `ExecuteWritePlan()` — rules wired before SQL write |

## Tests

**Unit tests** (no DB):
- `metadata/rule_test.go` — Rule/RuleDefinition JSON parsing, `GetRulesForEntity` filtering
- `engine/rules_test.go` — All 5 field operators, expression compilation + evaluation, computed fields, integer coercion

**Integration tests** (requires Postgres):
- `TestRulesCRUD` — Full admin API lifecycle (create, list, get, update, delete)
- `TestFieldRuleEnforcement` — Create entity + field rule, verify 422 on violation, 201 on pass
- `TestComputedFieldEnforcement` — Create entity + computed rule, verify computed value in response
