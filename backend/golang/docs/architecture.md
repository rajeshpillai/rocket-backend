# Go Implementation — Architecture

## Stack

| Component | Choice | Why |
|-----------|--------|-----|
| Web framework | Fiber v2 | Fast, Express-like API, context threading |
| DB driver | pgx v5 (`pgxpool`) | Native Go Postgres driver, pool-managed connections |
| Expression engine | expr-lang/expr | Compiles to bytecode, safe (no side effects), type-checked |
| Config | `app.yaml` via custom loader | Simple YAML, no heavy config library |

## Package Layout

```
golang/
├── cmd/server/main.go           # Entry point, wires everything
├── app.yaml                     # Config (port, DB credentials)
└── internal/
    ├── config/config.go          # YAML config parsing
    ├── metadata/
    │   ├── entity.go             # Entity, Field, PrimaryKey structs
    │   ├── relation.go           # Relation struct + helpers
    │   ├── rule.go               # Rule, RuleDefinition, RelatedLoadSpec
    │   ├── registry.go           # In-memory registry (sync.RWMutex)
    │   ├── loader.go             # Loads entities/relations/rules from DB
    │   └── rule_test.go          # Unit tests for Rule parsing + registry
    ├── store/
    │   ├── postgres.go           # Store, Querier, QueryRow/Exec/QueryRows, MapPgError
    │   ├── bootstrap.go          # System tables DDL (_entities, _relations, _rules)
    │   ├── migrator.go           # Auto-migration (CREATE TABLE / ALTER TABLE)
    │   └── postgres_test.go      # Unit tests for MapPgError
    ├── engine/
    │   ├── handler.go            # HTTP handlers (List, GetByID, Create, Update, Delete)
    │   ├── router.go             # RegisterDynamicRoutes
    │   ├── query.go              # Query parsing, SQL building (SELECT, COUNT)
    │   ├── writer.go             # ValidateFields, BuildInsertSQL, BuildUpdateSQL
    │   ├── nested_write.go       # PlanWrite, ExecuteWritePlan (tx-scoped)
    │   ├── diff.go               # Diff/replace/append logic for child writes
    │   ├── includes.go           # Separate-query relation loading
    │   ├── soft_delete.go        # Soft/hard delete SQL builders
    │   ├── errors.go             # AppError, ErrorDetail, error constructors
    │   ├── rules.go              # Rule evaluation engine
    │   ├── rules_test.go         # Unit tests for all rule types
    │   └── handler_integration_test.go  # Integration tests (build tag: integration)
    └── admin/
        └── handler.go            # Admin CRUD for entities, relations, rules
```

## Key Patterns

### Data Representation

All entity data flows as `map[string]any`. No per-entity Go structs exist — the metadata `Field` definitions provide type safety at runtime.

```go
// Reads:  []map[string]any — pgx scans columns dynamically
// Writes: map[string]any — parsed from JSON, validated against metadata
```

### Error Handling

Two-layer error interception:

1. **Store layer**: Sentinel errors (`ErrNotFound`, `ErrUniqueViolation`) + `MapPgError()` wraps `pgconn.PgError` codes
2. **Engine layer**: `AppError` with HTTP status codes, converted in `handleWriteError()`

```go
// Store detects DB error type
func MapPgError(err error) error {
    var pgErr *pgconn.PgError
    if errors.As(err, &pgErr) && pgErr.Code == "23505" {
        return fmt.Errorf("%w: %w", ErrUniqueViolation, err)
    }
    return err
}

// Handler converts to HTTP response
if errors.Is(err, store.ErrUniqueViolation) {
    return respondError(c, ConflictError(msg))
}
```

### Registry Thread Safety

The `Registry` uses `sync.RWMutex`:
- **Read operations** (every API request): `RLock` — concurrent, non-blocking
- **Write operations** (admin mutations): `Lock` — exclusive, blocks reads briefly during reload

### Transaction Scope

All writes run inside a single pgx transaction:

```
BEGIN
  → Evaluate rules (field → expression → computed)
  → INSERT/UPDATE parent
  → Execute child writes (nested relations)
COMMIT
  → Fetch and return full record
```

If rules fail, the transaction is rolled back and a 422 is returned.

### Context Threading

Every function that touches the DB accepts `context.Context` as the first parameter, propagated from Fiber's `c.Context()`.

## Dependencies

```
github.com/gofiber/fiber/v2      — web framework
github.com/jackc/pgx/v5          — Postgres driver + pool
github.com/expr-lang/expr         — expression evaluation engine
gopkg.in/yaml.v3                  — config file parsing
```

## Testing

```bash
# Unit tests (no DB required)
go test ./internal/engine/ ./internal/metadata/ ./internal/store/

# Integration tests (requires Postgres on port 5433)
go test -tags=integration ./internal/engine/ -v
```

Integration tests use the `//go:build integration` build tag and connect to the shared Docker Postgres instance.
