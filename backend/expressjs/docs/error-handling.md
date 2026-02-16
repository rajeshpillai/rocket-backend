# Express Implementation — Error Handling

## Error Flow

```
Database (pg error with code)
  → store.mapPgError()        — wraps known PG error codes as typed errors
  → middleware/error-handler   — converts errors to JSON response
```

## Store Layer

### Sentinel Errors

```typescript
export const ErrNotFound = new Error("not found");

export class UniqueViolationError extends Error {
  detail: string;
  constraint: string;
}
```

### mapPgError

Wraps `pg` errors with typed errors based on Postgres error codes:

| PG Code | Error Class | HTTP |
|---------|-------------|------|
| `23505` | `UniqueViolationError` | 409 |

`mapPgError` is called in all error paths of `queryRows`, `queryRow`, and `exec`.

## Engine Layer

### AppError

```typescript
export class AppError extends Error {
  code: string;
  status: number;
  details?: ErrorDetail[];
}

export interface ErrorDetail {
  field?: string;
  rule?: string;
  message: string;
}
```

### Error Constructors

| Constructor | Code | Status |
|-------------|------|--------|
| `notFoundError(entity, id)` | `NOT_FOUND` | 404 |
| `unknownEntityError(name)` | `UNKNOWN_ENTITY` | 404 |
| `conflictError(msg)` | `CONFLICT` | 409 |
| `validationError(details)` | `VALIDATION_FAILED` | 422 |
| `new AppError(code, status, msg)` | custom | custom |

### Error Middleware

Express error handler (`src/middleware/error-handler.ts`) serializes errors to JSON:

1. `AppError` — extracts `code`, `status`, `message`, and optional `details`
2. `UniqueViolationError` — converts to 409 CONFLICT using `conflictError()`
3. Fallback — logs the error, returns 500 `INTERNAL_ERROR`

### Handler Error Wrapping

Handlers use `asyncHandler()` to catch promise rejections and forward to the error middleware via `next(err)`. Write errors (unique constraint violations) bubble up from `executeWritePlan` through the middleware.

## Response Format

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed",
    "details": [
      { "field": "total", "rule": "min", "message": "Total must be non-negative" }
    ]
  }
}
```

Error codes: `UNKNOWN_ENTITY` (404), `NOT_FOUND` (404), `VALIDATION_FAILED` (422), `CONFLICT` (409), `INVALID_PAYLOAD` (400), `INTERNAL_ERROR` (500)

## Key Files

| File | Purpose |
|------|---------|
| `src/store/postgres.ts` | `ErrNotFound`, `UniqueViolationError`, `mapPgError()` |
| `src/engine/errors.ts` | `AppError`, `ErrorDetail`, error constructors |
| `src/middleware/error-handler.ts` | Express error middleware — serializes errors to JSON |
| `src/engine/handler.ts` | `asyncHandler()` wrapper, `resolveEntity()` |
