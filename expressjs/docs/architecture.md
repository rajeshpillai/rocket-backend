# Express Implementation — Architecture

## Stack

| Component | Choice | Why |
|-----------|--------|-----|
| Web framework | Express 4 | De-facto Node.js standard, middleware ecosystem |
| DB driver | pg (node-postgres) | Mature, pool-managed connections, parameterized queries |
| Expression engine | `Function` constructor with `with(env)` | No external dependency, safe enough for server-side metadata-defined rules |
| Config | `app.yaml` via custom loader | Matches Go implementation |
| Runtime | Node.js with tsx | TypeScript execution without compile step |

## Module Layout

```
expressjs/
├── src/
│   ├── index.ts                  # Entry point, wires everything
│   ├── config/index.ts           # YAML config parsing
│   ├── metadata/
│   │   ├── types.ts              # Entity, Field, Relation, PrimaryKey interfaces + helpers
│   │   ├── rule.ts               # Rule, RuleDefinition, RelatedLoadSpec interfaces
│   │   ├── registry.ts           # In-memory registry (Map-based)
│   │   └── loader.ts             # Loads entities/relations/rules from DB
│   ├── store/
│   │   ├── postgres.ts           # Store, Queryable, queryRow/exec/queryRows, mapPgError
│   │   ├── bootstrap.ts          # System tables DDL (_entities, _relations, _rules)
│   │   ├── migrator.ts           # Auto-migration
│   │   ├── schema.ts             # Schema introspection helpers
│   │   └── postgres.test.ts      # Unit tests for mapPgError
│   ├── engine/
│   │   ├── handler.ts            # HTTP handlers (list, getById, create, update, delete)
│   │   ├── router.ts             # registerDynamicRoutes
│   │   ├── query.ts              # Query parsing, SQL building
│   │   ├── writer.ts             # validateFields, buildInsertSQL, buildUpdateSQL
│   │   ├── nested-write.ts       # planWrite, executeWritePlan (tx-scoped)
│   │   ├── diff.ts               # Diff/replace/append logic for child writes
│   │   ├── includes.ts           # Separate-query relation loading
│   │   ├── soft-delete.ts        # Soft/hard delete SQL builders
│   │   ├── errors.ts             # AppError, ErrorDetail, error constructors
│   │   ├── rules.ts              # Rule evaluation engine
│   │   └── handler.integration.test.ts  # Integration tests (node:test)
│   ├── admin/
│   │   └── handler.ts            # Admin CRUD for entities, relations, rules
│   └── middleware/
│       └── error-handler.ts      # Express error middleware
├── package.json
├── tsconfig.json
└── app.yaml
```

## Key Patterns

### Data Representation

All entity data flows as `Record<string, any>`. No per-entity TypeScript interfaces — metadata `Field` definitions provide runtime type safety.

```typescript
// Reads:  Record<string, any>[] — pg returns rows as objects
// Writes: Record<string, any> — parsed from JSON body, validated against metadata
```

### Error Handling

Three-layer error interception:

1. **Store layer**: `mapPgError()` wraps PG error codes as typed errors (`UniqueViolationError`)
2. **Engine layer**: `AppError` class with HTTP status codes, thrown from handlers
3. **Middleware**: Express error handler catches all errors and serializes to JSON

```typescript
// Store detects DB error type
export function mapPgError(err: any): any {
  if (err.code === "23505") {
    return new UniqueViolationError(err.message, err.detail, err.constraint);
  }
  return err;
}

// Middleware converts to HTTP response
if (err instanceof AppError) {
  return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
}
if (err instanceof UniqueViolationError) {
  return res.status(409).json({ error: { code: "CONFLICT", message: err.detail || "..." } });
}
```

### AsyncHandler Pattern

Express doesn't catch promise rejections in route handlers. All async handlers are wrapped:

```typescript
function asyncHandler(fn: AsyncHandler) {
  return (req, res, next) => fn(req, res, next).catch(next);
}
```

### Transaction Scope

All writes run inside a pg client transaction:

```
client = pool.connect()
BEGIN
  → Evaluate rules (field → expression → computed)
  → INSERT/UPDATE parent
  → Execute child writes (nested relations)
COMMIT
  → client.release()
  → Fetch and return full record
```

If rules fail, ROLLBACK is executed and a 422 `AppError` is thrown.

### Registry

The `Registry` class uses `Map<string, T>` for lookups. No mutex needed — Node.js is single-threaded. Reload replaces all maps atomically.

## Dependencies

```
express            — web framework
pg                 — Postgres driver + pool
js-yaml            — config file parsing
```

No external expression library — expressions use `new Function('env', 'with (env) { return (...) }')` for server-side evaluation of metadata-defined rules.

## Testing

```bash
# Unit tests (no DB required)
npx tsx --test src/store/postgres.test.ts

# Integration tests (requires Postgres on port 5433)
npx tsx --test src/engine/handler.integration.test.ts
```

Tests use Node.js built-in `node:test` runner with `node:assert/strict`. Integration tests create a temporary HTTP server per test suite using `http.createServer(app)`.
