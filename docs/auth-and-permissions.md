# Auth & Permissions — Technical Design

## Overview

Rocket uses **JWT-based authentication** for API access and **metadata-driven permission policies** for authorization. Auth verifies *who you are*. Permissions determine *what you can do*, evaluated against entity metadata — not hardcoded per entity.

---

## Authentication

### Endpoints

```
POST /api/auth/login     → { access_token, refresh_token }
POST /api/auth/refresh   → { access_token, refresh_token }
POST /api/auth/logout    → revokes refresh token
```

### Login Flow

```
1. Client sends POST /api/auth/login
   Body: { "email": "user@example.com", "password": "..." }

2. Engine looks up user in _users table by email
   → Not found or password mismatch → 401

3. Verify password hash (bcrypt)

4. Generate tokens:
   - Access token: JWT, 15 min TTL
   - Refresh token: opaque UUID, 7 day TTL, stored in _refresh_tokens table

5. Return both tokens
```

### Access Token (JWT)

```json
{
  "sub": "user-uuid",
  "roles": ["admin", "accountant"],
  "iat": 1705320000,
  "exp": 1705320900
}
```

| Property | Description |
|----------|-------------|
| `sub` | User ID (UUID) |
| `roles` | Array of role names assigned to this user |
| `iat` | Issued at timestamp |
| `exp` | Expiration timestamp (15 minutes after issue) |

Signed with HS256 using a secret from `app.yaml` / env var `JWT_SECRET`.

### Refresh Token

- Opaque UUID stored in `_refresh_tokens` table
- Linked to user ID
- 7-day TTL
- **Rotated on every use:** when a refresh token is used, the old one is invalidated and a new one is issued
- This prevents reuse of stolen refresh tokens

### Refresh Flow

```
1. Client sends POST /api/auth/refresh
   Body: { "refresh_token": "uuid-here" }

2. Look up token in _refresh_tokens table
   → Not found or expired → 401

3. Delete the used refresh token (rotation)

4. Generate new access token + new refresh token

5. Return both
```

### System Tables for Auth

```sql
CREATE TABLE _users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    roles           TEXT[] DEFAULT '{}',
    active          BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE _refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES _users(id),
    token       UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_token ON _refresh_tokens (token);
CREATE INDEX idx_refresh_tokens_expires ON _refresh_tokens (expires_at);
```

---

## Fiber Middleware

Auth middleware runs on all `/api/:entity` routes. It extracts the JWT, validates it, and sets user context for downstream handlers.

```
Request arrives
  → middleware.Auth()
  → Extract "Authorization: Bearer <token>" header
     → Missing → 401 { "error": { "code": "UNAUTHORIZED", "message": "Missing auth token" } }
  → Decode + verify JWT signature and expiration
     → Invalid/expired → 401 { "error": { "code": "UNAUTHORIZED", "message": "Invalid or expired token" } }
  → Set user context:
     c.Locals("user", &UserContext{
         ID:    "user-uuid",
         Roles: ["admin", "accountant"],
     })
  → Call next handler
```

### Routes That Skip Auth

| Route | Reason |
|-------|--------|
| `POST /api/auth/login` | Login itself doesn't require auth |
| `POST /api/auth/refresh` | Token refresh uses refresh token, not JWT |
| `GET /admin/*` | Static files (SolidJS app). Admin API calls still require auth |
| `GET /health` | Health check endpoint |

---

## Permissions

Permissions are **policy-driven** — defined as metadata in the `_permissions` table, not as `if/else` logic in code. Every entity + action combination is checked before any write or read proceeds.

### Permission Definition

```json
{
  "entity": "invoice",
  "action": "update",
  "roles": ["admin", "accountant"],
  "conditions": [
    { "field": "status", "operator": "in", "value": ["draft", "sent"] }
  ]
}
```

This means: users with role `admin` or `accountant` can update invoices, but only if the invoice's current status is `draft` or `sent`.

### Permission Properties

| Property | Type | Description |
|----------|------|-------------|
| `entity` | string | Entity name this policy applies to |
| `action` | string | `read`, `create`, `update`, `delete` |
| `roles` | string[] | Roles allowed to perform this action |
| `conditions` | array | Optional field-level conditions on the **current record** (for update/delete) or injected as filters (for read) |

### Evaluation Flow

```
1. User requests: PUT /api/invoice/uuid-123
   User context: { roles: ["accountant"] }

2. Engine looks up all _permissions rows where entity="invoice" AND action="update"

3. For each matching policy:
   a. Check if user has any of the policy's roles
      → ["accountant"] intersects ["admin", "accountant"]? → yes

   b. If conditions exist, check against current record state:
      → Fetch current record: SELECT status FROM invoices WHERE id = $1
      → Evaluate: status IN ["draft", "sent"]?
      → Current status = "draft" → passes

4. If ANY policy passes → authorized
   If NO policy passes → 403 Forbidden
```

### No Permission = Denied

If no `_permissions` row exists for an entity + action combination, the action is **denied by default**. This is a whitelist model — you must explicitly grant access.

### Read Permissions: Filter Injection

For `read` actions, permission conditions are injected as additional WHERE clauses rather than rejecting the entire request:

```
Permission: { entity: "invoice", action: "read", roles: ["accountant"], conditions: [{ field: "department", operator: "eq", value: "finance" }] }

User with role "accountant" runs: GET /api/invoice

Engine adds to query:
  WHERE ... AND department = 'finance'

The user only sees invoices from the finance department. No 403 — just scoped data.
```

This enables **row-level security** through metadata, without Postgres RLS.

### Permission Conditions: Operators

Same operators as field validation rules:

| Operator | Meaning | Example |
|----------|---------|---------|
| `eq` | Equals | `{ "field": "status", "operator": "eq", "value": "draft" }` |
| `neq` | Not equals | `{ "field": "status", "operator": "neq", "value": "void" }` |
| `in` | In list | `{ "field": "status", "operator": "in", "value": ["draft", "sent"] }` |
| `not_in` | Not in list | `{ "field": "status", "operator": "not_in", "value": ["void"] }` |
| `gt`, `gte`, `lt`, `lte` | Comparison | `{ "field": "total", "operator": "lte", "value": 10000 }` |

### Admin Role

Users with the `admin` role bypass all permission checks. This is hardcoded in the permission engine — there's no `_permissions` row needed for admin access. The admin role also grants access to:

- All `/api/_admin/*` endpoints (entity management, metadata APIs)
- The admin UI

---

## User Management

Users are stored in the `_users` system table. The admin UI provides a user management page, and there's also an API:

```
GET    /api/_admin/users           — list users (admin only)
POST   /api/_admin/users           — create user (admin only)
PUT    /api/_admin/users/:id       — update user / assign roles (admin only)
DELETE /api/_admin/users/:id       — deactivate user (admin only)
```

### Roles

Roles are simple strings stored as a Postgres `TEXT[]` array on the user record. There's no role hierarchy — a user either has a role or doesn't. Role names are referenced in `_permissions` policies.

Common roles: `admin`, `manager`, `editor`, `viewer`, `accountant`, `hr`

### Initial Admin User

On first boot (empty `_users` table), the engine creates a default admin:

```
email:    admin@localhost
password: changeme (bcrypt hashed)
roles:    ["admin"]
```

A startup log warns: `"Default admin created — change the password immediately."`

---

## User Invites

An alternative to direct user creation — admin invites users by email, and invitees set their own password.

### System Table

```
_invites — id (UUID PK), email, roles (TEXT[]), token (UNIQUE), expires_at, accepted_at, invited_by (UUID), created_at
```

### Endpoints

```
POST   /_admin/invites        # Admin creates invite {email, roles} → returns invite with token
POST   /_admin/invites/bulk   # Admin bulk creates invites {emails, roles} → {created, skipped, summary}
GET    /_admin/invites         # Admin lists all invites
DELETE /_admin/invites/:id     # Admin revokes/cancels invite
POST   /auth/accept-invite     # Public — accept invite {token, password} → {access_token, refresh_token, user}
```

### Invite Lifecycle

1. **Create**: Admin calls `POST /_admin/invites` with `{email, roles}`. System validates email is not an existing user and no pending invite exists, generates a crypto-random token (72h expiry), and returns the invite record including the token.
2. **Share**: Admin copies the token and shares it with the invitee (manually, or via a webhook-triggered email).
3. **Accept**: Invitee calls `POST /auth/accept-invite` with `{token, password}`. System validates the token, creates the user (active, with assigned roles), marks the invite as accepted, and returns access + refresh tokens so the invitee is immediately logged in.
4. **Expiry**: Unaccepted invites expire after 72 hours. Expired tokens are rejected on accept.
5. **Revoke**: Admin can delete a pending invite at any time via `DELETE /_admin/invites/:id`.

### Bulk Invites

For organizations onboarding many users at once, `POST /_admin/invites/bulk` accepts multiple emails with shared roles:

```json
// Request
{ "emails": ["alice@co.com", "bob@co.com"], "roles": ["editor"] }

// Response
{
  "data": {
    "created": [
      { "id": "uuid", "email": "alice@co.com", "token": "tok-1", "expires_at": "..." },
      { "id": "uuid", "email": "bob@co.com", "token": "tok-2", "expires_at": "..." }
    ],
    "skipped": [],
    "summary": { "total": 2, "created": 2, "skipped": 0 }
  }
}
```

- Emails are trimmed, lowercased, and deduplicated before processing
- Each email is validated independently (existing user? pending invite?)
- Valid invites succeed even if others are skipped (skip & report pattern)
- Skipped entries include a `reason` field explaining why

### Validation Rules

- Email must not already exist in `_users` (409 CONFLICT)
- No pending (non-expired, non-accepted) invite for the same email (409 CONFLICT)
- Token must exist and not be expired or already accepted
- Both token and password required on accept (422 VALIDATION_FAILED)

### Design Notes

- Purely additive — no changes to existing `_users` table or auth flow
- Direct user creation via `POST /_admin/users` continues to work unchanged
- Email delivery is not built into the engine — use webhooks or share tokens manually
- Accept-invite returns tokens directly, avoiding a separate login call
