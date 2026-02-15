# Email Providers & Templates

## Overview

Rocket's email system allows admins to configure email delivery providers and customize templates entirely from the Admin UI — no code changes needed. Emails are sent asynchronously after system events (invite creation, password reset, etc.) with automatic fallback to secondary providers on failure.

If no provider is configured, the engine continues to work normally — admins share tokens manually.

## System Tables

### `_email_providers`

Stores configured email delivery providers with priority-based fallback.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Auto-generated |
| `name` | TEXT UNIQUE | Label: "primary", "fallback", or custom |
| `provider` | TEXT | `sendgrid` \| `postmark` \| `smtp` \| `resend` \| `mailgun` |
| `config` | JSONB | Provider-specific config (secrets via `{{env.VAR}}` references) |
| `priority` | INT DEFAULT 0 | Lower = tried first |
| `active` | BOOLEAN DEFAULT true | Enable/disable without deleting |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

#### Provider Config Examples

**SendGrid**
```json
{
  "api_key": "{{env.SENDGRID_API_KEY}}",
  "from": "noreply@myapp.com",
  "from_name": "MyApp"
}
```

**Postmark**
```json
{
  "server_token": "{{env.POSTMARK_TOKEN}}",
  "from": "noreply@myapp.com",
  "from_name": "MyApp"
}
```

**SMTP**
```json
{
  "host": "smtp.gmail.com",
  "port": 587,
  "tls": true,
  "username": "noreply@myapp.com",
  "password": "{{env.SMTP_PASSWORD}}",
  "from": "noreply@myapp.com",
  "from_name": "MyApp"
}
```

**Resend**
```json
{
  "api_key": "{{env.RESEND_API_KEY}}",
  "from": "noreply@myapp.com",
  "from_name": "MyApp"
}
```

**Mailgun**
```json
{
  "api_key": "{{env.MAILGUN_API_KEY}}",
  "domain": "mg.myapp.com",
  "from": "noreply@myapp.com",
  "from_name": "MyApp"
}
```

Secrets are never stored in plaintext — `{{env.VAR}}` references are resolved at send time from environment variables (same pattern as webhook headers).

### `_email_templates`

Customizable email templates with `{{variable}}` interpolation.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Auto-generated |
| `key` | TEXT UNIQUE | Template identifier: `invite`, `welcome`, `password_reset`, or custom |
| `subject` | TEXT | Email subject with `{{variable}}` placeholders |
| `body_html` | TEXT | HTML body with `{{variable}}` placeholders |
| `body_text` | TEXT | Plain text fallback |
| `active` | BOOLEAN DEFAULT true | Enable/disable |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

### `_email_logs`

Delivery log for auditing and debugging (mirrors `_webhook_logs` pattern).

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Auto-generated |
| `provider_id` | UUID FK | Provider used for delivery |
| `template_key` | TEXT | Template key used |
| `to_email` | TEXT | Recipient email |
| `subject` | TEXT | Resolved subject line |
| `status` | TEXT | `pending` \| `delivered` \| `failed` \| `retrying` |
| `provider_response` | JSONB | Raw response from provider |
| `error` | TEXT | Error message on failure |
| `attempt` | INT DEFAULT 1 | Current attempt number |
| `created_at` | TIMESTAMPTZ | |

## Built-in Templates

The engine ships with default templates that admins can override from the UI.

### `invite`

**Subject:** `You've been invited to {{app_name}}`

**Available variables:**

| Variable | Description | Example |
|----------|-------------|---------|
| `{{email}}` | Invitee email | `jane@co.com` |
| `{{token}}` | Raw invite token | `a1b2c3d4-...` |
| `{{accept_url}}` | Full accept link (if `invite_accept_url` configured in app settings) | `https://myapp.com/accept?token=a1b2...` |
| `{{roles}}` | Comma-separated roles | `editor, viewer` |
| `{{expires_at}}` | Token expiry timestamp | `2025-06-15T12:00:00Z` |
| `{{invited_by}}` | Inviter's email (if available) | `admin@co.com` |
| `{{app_name}}` | Application display name | `MyApp` |

**Default HTML body:**
```html
<h2>You've been invited to {{app_name}}</h2>
<p>You've been invited to join <strong>{{app_name}}</strong> with the following roles: <strong>{{roles}}</strong>.</p>
<p>Click the link below to set your password and activate your account:</p>
<p><a href="{{accept_url}}">Accept Invitation</a></p>
<p>This invitation expires on {{expires_at}}.</p>
<p>If you didn't expect this invitation, you can safely ignore this email.</p>
```

**Default plain text body:**
```
You've been invited to {{app_name}}

You've been invited to join {{app_name}} with the following roles: {{roles}}.

Accept your invitation: {{accept_url}}

This invitation expires on {{expires_at}}.

If you didn't expect this invitation, you can safely ignore this email.
```

### `welcome`

Sent after a user successfully accepts an invite.

**Subject:** `Welcome to {{app_name}}`

**Variables:** `{{email}}`, `{{roles}}`, `{{app_name}}`

### `password_reset` (future)

**Subject:** `Reset your password for {{app_name}}`

**Variables:** `{{email}}`, `{{token}}`, `{{reset_url}}`, `{{app_name}}`

### Custom Templates

Admins can create templates with any key (e.g., `order_confirmation`, `approval_needed`). Custom templates can be triggered via:
- Workflow action steps (future): `{ "type": "send_email", "template": "order_confirmation", "to": "{{record.email}}" }`
- The send-email API endpoint: `POST /_admin/email/send`

## App Settings

A new `email` section in app settings (stored in `_apps` table config or a dedicated `_app_settings` table):

```json
{
  "invite_accept_url": "https://myapp.com/accept-invite?token={{token}}",
  "app_name": "MyApp"
}
```

- `invite_accept_url` — URL template for the accept-invite link. If not set, emails include the raw token instead.
- `app_name` — Used in email subjects and bodies. Falls back to the app's `display_name` from `_apps`.

## Dispatch Flow

### On Invite Creation

```
1. Admin creates invite (POST /_admin/invites or /invites/bulk)
2. Invite record created in _invites table
3. API responds immediately (invite created successfully)
4. Async: engine checks if an active email provider exists
   - No provider → skip (admin shares token manually)
   - Provider exists → continue
5. Resolve template "invite" from _email_templates
   - No template → use built-in default
   - Template inactive → skip
6. Substitute variables (email, token, accept_url, roles, etc.)
7. Dispatch to primary provider (lowest priority number)
   - Success → log to _email_logs (status: delivered)
   - Failure → try next provider by priority (fallback)
   - All providers fail → log to _email_logs (status: failed)
```

### Provider Fallback

```
Providers sorted by priority ASC, filtered by active = true:

  priority=0  SendGrid (primary)    → try first
  priority=10 SMTP (fallback)       → try if SendGrid fails

If primary fails:
  - Log attempt with error
  - Try next provider
  - If all fail, log final failure
```

### Template Resolution

```
1. Look up _email_templates WHERE key = '<template_key>' AND active = true
2. If found → use custom template
3. If not found → use built-in default
4. Substitute all {{variable}} placeholders with actual values
5. Unresolved variables are replaced with empty string
```

## Admin API Endpoints

### Email Providers

```
GET    /_admin/email/providers          # List all providers
POST   /_admin/email/providers          # Create provider
GET    /_admin/email/providers/:id      # Get provider
PUT    /_admin/email/providers/:id      # Update provider
DELETE /_admin/email/providers/:id      # Delete provider
POST   /_admin/email/providers/:id/test # Send test email to verify config
```

### Email Templates

```
GET    /_admin/email/templates          # List all templates (includes built-in defaults)
POST   /_admin/email/templates          # Create custom template
GET    /_admin/email/templates/:id      # Get template
PUT    /_admin/email/templates/:id      # Update template
DELETE /_admin/email/templates/:id      # Delete custom template (built-ins can't be deleted)
POST   /_admin/email/templates/:id/preview  # Preview with sample data
```

### Email Logs

```
GET    /_admin/email/logs               # List logs (?status, ?template_key, ?to_email filters)
GET    /_admin/email/logs/:id           # Get log detail
```

### Send Email (ad-hoc)

```
POST   /_admin/email/send              # Send email using template
```

```json
{
  "template": "invite",
  "to": "jane@co.com",
  "variables": {
    "app_name": "MyApp",
    "accept_url": "https://..."
  }
}
```

## Admin UI Pages

### Settings > Email Providers

- List configured providers with status badges (active/inactive)
- Create/edit modal: provider dropdown, config JSON editor, priority, active toggle
- "Test Connection" button: sends a test email to the admin's address
- Drag-to-reorder for priority (or numeric input)

### Settings > Email Templates

- List all templates (built-in defaults shown with "Default" badge, custom overrides with "Custom" badge)
- Edit modal: subject, HTML body (code editor or rich text), plain text body
- Variable reference panel: shows available variables for the selected template key
- "Preview" button: renders template with sample data
- "Reset to Default" button for overridden built-in templates

### Settings > Email Logs

- Table: timestamp, to, subject, template, provider, status (badge)
- Filters: status, template key, date range
- Detail view: full request/response, error details

## Implementation Notes

### Provider Adapter Interface

Each provider implements a simple interface:

```
SendEmail(to, subject, htmlBody, textBody, from, fromName) → (providerResponse, error)
```

Provider adapters:
- **SendGrid**: `POST https://api.sendgrid.com/v3/mail/send` with Bearer token
- **Postmark**: `POST https://api.postmarkapp.com/email` with `X-Postmark-Server-Token`
- **SMTP**: Standard SMTP with TLS support
- **Resend**: `POST https://api.resend.com/emails` with Bearer token
- **Mailgun**: `POST https://api.mailgun.net/v3/{domain}/messages` with Basic auth

All use the same HTTP client pattern already in the codebase (Go: `net/http`, Express: `fetch`, Elixir: `HTTPoison`/`Req`).

### Template Engine

Simple `{{variable}}` substitution — same regex-based replacement already used for webhook header `{{env.VAR}}` resolution. No conditionals or loops needed.

### Integration Points

1. **Invite creation** (`CreateInvite`, `BulkCreateInvites`) — after successful insert, dispatch invite email async
2. **Accept invite** (`AcceptInvite`) — after successful user creation, dispatch welcome email async
3. **Workflow steps** (future) — `send_email` action type in workflow engine
4. **Ad-hoc API** — `POST /_admin/email/send` for admin-triggered emails

### Async Dispatch

Emails are sent after the API response (fire-and-forget goroutine / `setTimeout` / `Task.async`), same pattern as async webhooks. The caller never waits for email delivery.
