# Go Implementation — Error Handling

## Error Flow

```
Database (pgconn.PgError)
  → store.MapPgError()        — wraps known PG error codes as sentinel errors
  → engine.handleWriteError() — converts sentinel errors to AppError with HTTP status
  → Fiber error handler       — serializes AppError to JSON response
```

## Store Layer

### Sentinel Errors

```go
var ErrNotFound         = errors.New("not found")
var ErrUniqueViolation  = errors.New("unique constraint violation")
```

### MapPgError

Wraps `pgconn.PgError` with sentinel errors based on Postgres error codes:

| PG Code | Sentinel | HTTP |
|---------|----------|------|
| `23505` | `ErrUniqueViolation` | 409 |

`MapPgError` is called in all error paths of `QueryRows`, `Exec`, and `QueryRow` — including the `rows.Err()` path (critical for INSERT...RETURNING which surfaces errors at iteration time, not query time).

## Engine Layer

### AppError

```go
type AppError struct {
    Code    string        `json:"code"`
    Status  int           `json:"-"`
    Message string        `json:"message"`
    Details []ErrorDetail `json:"details,omitempty"`
}
```

### Error Constructors

| Constructor | Code | Status |
|-------------|------|--------|
| `NotFoundError(entity, id)` | `NOT_FOUND` | 404 |
| `UnknownEntityError(name)` | `UNKNOWN_ENTITY` | 404 |
| `ConflictError(msg)` | `CONFLICT` | 409 |
| `ValidationError(details)` | `VALIDATION_FAILED` | 422 |
| `NewAppError(code, status, msg)` | custom | custom |

### handleWriteError

Converts errors from `ExecuteWritePlan` to HTTP responses:

1. Check `errors.As(err, &appErr)` — rule validation errors (422)
2. Check `errors.Is(err, store.ErrUniqueViolation)` — unique constraint (409), extracts detail from `pgconn.PgError.Detail`
3. Fallback — returns raw error to Fiber's default error handler (500)

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
