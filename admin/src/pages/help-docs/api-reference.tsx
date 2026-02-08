import { Section, CodeBlock, PropsTable, EndpointBlock, C } from "./help-components";

export default function ApiReference() {
  return (
    <div>
      {/* ── Platform Endpoints ── */}
      <Section title="Platform Endpoints" id="platform-endpoints">
        <p>
          Platform endpoints manage the Rocket Backend control plane -- authentication for platform
          administrators and app lifecycle management. Login, refresh, and logout do not require a
          token. App management endpoints require a valid platform admin token.
        </p>
        <EndpointBlock method="POST" url="/api/_platform/auth/login" description="Platform admin login. Returns access_token and refresh_token." />
        <EndpointBlock method="POST" url="/api/_platform/auth/refresh" description="Refresh a platform access token using a refresh token." />
        <EndpointBlock method="POST" url="/api/_platform/auth/logout" description="Invalidate a platform refresh token." />
        <EndpointBlock method="GET" url="/api/_platform/apps" description="List all apps." />
        <EndpointBlock method="POST" url="/api/_platform/apps" description="Create a new app. Provisions a database and bootstraps system tables." />
        <EndpointBlock method="GET" url="/api/_platform/apps/:name" description="Get details for a specific app." />
        <EndpointBlock method="DELETE" url="/api/_platform/apps/:name" description="Delete an app and drop its database." />
      </Section>

      {/* ── App Auth Endpoints ── */}
      <Section title="App Auth Endpoints" id="app-auth-endpoints">
        <p>
          Per-app authentication endpoints. These do <strong>not</strong> require a token -- they
          are used to obtain tokens for an app's users.
        </p>
        <EndpointBlock method="POST" url="/api/:app/auth/login" description="Per-app user login. Returns access_token and refresh_token." />
        <EndpointBlock method="POST" url="/api/:app/auth/refresh" description="Refresh an app access token using a refresh token." />
        <EndpointBlock method="POST" url="/api/:app/auth/logout" description="Invalidate an app refresh token." />
      </Section>

      {/* ── Admin Endpoints ── */}
      <Section title="Admin Endpoints" id="admin-endpoints">
        <p>
          Admin endpoints require authentication with the <C>admin</C> role. They manage all
          metadata that defines your app's schema and business logic.
        </p>

        <h3>Entities</h3>
        <EndpointBlock method="GET" url="/api/:app/_admin/entities" description="List all entity definitions." />
        <EndpointBlock method="POST" url="/api/:app/_admin/entities" description="Create a new entity. Triggers auto-migration." />
        <EndpointBlock method="GET" url="/api/:app/_admin/entities/:name" description="Get a single entity definition by name." />
        <EndpointBlock method="PUT" url="/api/:app/_admin/entities/:name" description="Update an entity definition. New fields trigger ALTER TABLE." />
        <EndpointBlock method="DELETE" url="/api/:app/_admin/entities/:name" description="Delete an entity definition." />

        <h3>Relations</h3>
        <EndpointBlock method="GET" url="/api/:app/_admin/relations" description="List all relation definitions." />
        <EndpointBlock method="POST" url="/api/:app/_admin/relations" description="Create a new relation between two entities." />
        <EndpointBlock method="GET" url="/api/:app/_admin/relations/:name" description="Get a single relation by name." />
        <EndpointBlock method="PUT" url="/api/:app/_admin/relations/:name" description="Update a relation definition." />
        <EndpointBlock method="DELETE" url="/api/:app/_admin/relations/:name" description="Delete a relation." />

        <h3>Rules</h3>
        <EndpointBlock method="GET" url="/api/:app/_admin/rules" description="List all rules." />
        <EndpointBlock method="POST" url="/api/:app/_admin/rules" description="Create a new rule (validation, computed, side-effect)." />
        <EndpointBlock method="GET" url="/api/:app/_admin/rules/:id" description="Get a single rule by ID." />
        <EndpointBlock method="PUT" url="/api/:app/_admin/rules/:id" description="Update a rule." />
        <EndpointBlock method="DELETE" url="/api/:app/_admin/rules/:id" description="Delete a rule." />

        <h3>State Machines</h3>
        <EndpointBlock method="GET" url="/api/:app/_admin/state-machines" description="List all state machine definitions." />
        <EndpointBlock method="POST" url="/api/:app/_admin/state-machines" description="Create a new state machine." />
        <EndpointBlock method="GET" url="/api/:app/_admin/state-machines/:id" description="Get a single state machine by ID." />
        <EndpointBlock method="PUT" url="/api/:app/_admin/state-machines/:id" description="Update a state machine." />
        <EndpointBlock method="DELETE" url="/api/:app/_admin/state-machines/:id" description="Delete a state machine." />

        <h3>Workflows</h3>
        <EndpointBlock method="GET" url="/api/:app/_admin/workflows" description="List all workflow definitions." />
        <EndpointBlock method="POST" url="/api/:app/_admin/workflows" description="Create a new workflow." />
        <EndpointBlock method="GET" url="/api/:app/_admin/workflows/:id" description="Get a single workflow by ID." />
        <EndpointBlock method="PUT" url="/api/:app/_admin/workflows/:id" description="Update a workflow." />
        <EndpointBlock method="DELETE" url="/api/:app/_admin/workflows/:id" description="Delete a workflow." />

        <h3>Users</h3>
        <EndpointBlock method="GET" url="/api/:app/_admin/users" description="List all users in the app." />
        <EndpointBlock method="POST" url="/api/:app/_admin/users" description="Create a new user." />
        <EndpointBlock method="GET" url="/api/:app/_admin/users/:id" description="Get a single user by ID." />
        <EndpointBlock method="PUT" url="/api/:app/_admin/users/:id" description="Update a user (email, roles, active status)." />
        <EndpointBlock method="DELETE" url="/api/:app/_admin/users/:id" description="Delete a user." />

        <h3>Permissions</h3>
        <EndpointBlock method="GET" url="/api/:app/_admin/permissions" description="List all permission policies." />
        <EndpointBlock method="POST" url="/api/:app/_admin/permissions" description="Create a new permission policy." />
        <EndpointBlock method="GET" url="/api/:app/_admin/permissions/:id" description="Get a single permission by ID." />
        <EndpointBlock method="PUT" url="/api/:app/_admin/permissions/:id" description="Update a permission policy." />
        <EndpointBlock method="DELETE" url="/api/:app/_admin/permissions/:id" description="Delete a permission policy." />

        <h3>Webhooks</h3>
        <EndpointBlock method="GET" url="/api/:app/_admin/webhooks" description="List all webhook definitions." />
        <EndpointBlock method="POST" url="/api/:app/_admin/webhooks" description="Create a new webhook." />
        <EndpointBlock method="GET" url="/api/:app/_admin/webhooks/:id" description="Get a single webhook by ID." />
        <EndpointBlock method="PUT" url="/api/:app/_admin/webhooks/:id" description="Update a webhook." />
        <EndpointBlock method="DELETE" url="/api/:app/_admin/webhooks/:id" description="Delete a webhook." />

        <h3>Webhook Logs</h3>
        <EndpointBlock method="GET" url="/api/:app/_admin/webhook-logs" description="List webhook delivery logs. Supports ?webhook_id, ?status, ?entity filters." />
        <EndpointBlock method="GET" url="/api/:app/_admin/webhook-logs/:id" description="Get a single webhook log entry by ID." />
        <EndpointBlock method="POST" url="/api/:app/_admin/webhook-logs/:id/retry" description="Manually retry a failed webhook delivery." />

        <h3>Schema Export/Import</h3>
        <EndpointBlock method="GET" url="/api/:app/_admin/export" description="Export all metadata as a single JSON document." />
        <EndpointBlock method="POST" url="/api/:app/_admin/import" description="Import schema JSON. Idempotent deduplication." />
      </Section>

      {/* ── File Endpoints ── */}
      <Section title="File Endpoints" id="file-endpoints">
        <p>
          File endpoints handle upload, serving, deletion, and listing of files. Upload and serve
          require authentication. Delete and list require the <C>admin</C> role.
        </p>
        <EndpointBlock method="POST" url="/api/:app/_files/upload" description="Upload a file (multipart/form-data, field name 'file')." />
        <EndpointBlock method="GET" url="/api/:app/_files/:id" description="Serve/download a file with correct Content-Type." />
        <EndpointBlock method="DELETE" url="/api/:app/_files/:id" description="Delete a file (admin only)." />
        <EndpointBlock method="GET" url="/api/:app/_files" description="List all uploaded files (admin only)." />
      </Section>

      {/* ── Workflow Runtime Endpoints ── */}
      <Section title="Workflow Runtime Endpoints" id="workflow-runtime-endpoints">
        <p>
          Workflow runtime endpoints allow you to monitor and interact with running workflow
          instances -- viewing pending approvals, inspecting instance state, and approving or
          rejecting steps.
        </p>
        <EndpointBlock method="GET" url="/api/:app/_workflows/pending" description="List workflow instances waiting for approval." />
        <EndpointBlock method="GET" url="/api/:app/_workflows/:id" description="Get full details of a workflow instance." />
        <EndpointBlock method="POST" url="/api/:app/_workflows/:id/approve" description="Approve the current step of a workflow instance." />
        <EndpointBlock method="POST" url="/api/:app/_workflows/:id/reject" description="Reject the current step of a workflow instance." />
      </Section>

      {/* ── Dynamic Entity Endpoints ── */}
      <Section title="Dynamic Entity Endpoints" id="dynamic-entity-endpoints">
        <p>
          Every entity defined in Rocket automatically gets these five endpoints. Replace{" "}
          <C>:entity</C> with the entity name (e.g., <C>customer</C>, <C>invoice</C>).
        </p>
        <EndpointBlock method="GET" url="/api/:app/:entity" description="List records with filters, sorting, pagination, and includes." />
        <EndpointBlock method="GET" url="/api/:app/:entity/:id" description="Get a single record by ID with optional includes." />
        <EndpointBlock method="POST" url="/api/:app/:entity" description="Create a record with optional nested writes." />
        <EndpointBlock method="PUT" url="/api/:app/:entity/:id" description="Update a record with optional nested writes." />
        <EndpointBlock method="DELETE" url="/api/:app/:entity/:id" description="Soft or hard delete depending on entity configuration." />
      </Section>

      {/* ── Query Parameters ── */}
      <Section title="Query Parameters" id="query-parameters">
        <p>
          The list endpoint (<C>GET /api/:app/:entity</C>) supports the following query
          parameters for filtering, sorting, pagination, and including related data.
        </p>
        <PropsTable
          columns={["Parameter", "Example", "Description"]}
          rows={[
            [<C>filter[field]</C>, <C>filter[status]=active</C>, "Exact equality filter on a field."],
            [<C>filter[field.op]</C>, <C>filter[total.gte]=1000</C>, "Comparison filter using an operator (eq, neq, gt, gte, lt, lte, in, not_in, like)."],
            [<C>sort</C>, <C>sort=name,-created_at</C>, "Comma-separated field names. Prefix with - for descending order."],
            [<C>page</C>, <C>page=2</C>, "Page number (1-indexed). Default: 1."],
            [<C>per_page</C>, <C>per_page=50</C>, "Records per page. Default: 25. Maximum: 100."],
            [<C>include</C>, <C>include=items,customer</C>, "Comma-separated relation names to include in the response."],
          ]}
        />
      </Section>

      {/* ── Filter Operators ── */}
      <Section title="Filter Operators" id="filter-operators">
        <p>
          Use filter operators with the dot syntax: <C>filter[field.operator]=value</C>. The
          default operator (when no dot suffix is used) is <C>eq</C>.
        </p>
        <PropsTable
          columns={["Operator", "Syntax", "Description"]}
          rows={[
            [<C>eq</C>, <C>filter[status]=active</C>, "Equal to. This is the default when no operator is specified."],
            [<C>neq</C>, <C>filter[status.neq]=archived</C>, "Not equal to."],
            [<C>gt</C>, <C>filter[amount.gt]=1000</C>, "Greater than."],
            [<C>gte</C>, <C>filter[amount.gte]=1000</C>, "Greater than or equal to."],
            [<C>lt</C>, <C>filter[amount.lt]=500</C>, "Less than."],
            [<C>lte</C>, <C>filter[amount.lte]=500</C>, "Less than or equal to."],
            [<C>in</C>, <C>filter[status.in]=draft,sent</C>, "Value is one of a comma-separated list."],
            [<C>not_in</C>, <C>filter[status.not_in]=archived,deleted</C>, "Value is not one of a comma-separated list."],
            [<C>like</C>, <C>filter[name.like]=%acme%</C>, "SQL LIKE pattern match. Use % as wildcard."],
          ]}
        />
      </Section>

      {/* ── Error Codes ── */}
      <Section title="Error Codes" id="error-codes">
        <p>
          All error responses use a standard format with a machine-readable code, human-readable
          message, and optional field-level details. The following error codes may be returned:
        </p>
        <PropsTable
          columns={["Code", "HTTP Status", "Description"]}
          rows={[
            [<C>UNKNOWN_ENTITY</C>, "404", "The entity name in the URL does not match any defined entity."],
            [<C>NOT_FOUND</C>, "404", "The record with the given ID does not exist or has been soft-deleted."],
            [<C>VALIDATION_FAILED</C>, "422", "One or more fields failed validation. Check the details array for field-specific errors."],
            [<C>UNKNOWN_FIELD</C>, "400", "The request body contains a field name not defined in the entity schema."],
            [<C>INVALID_PAYLOAD</C>, "400", "The request body is malformed, missing, or not valid JSON."],
            [<C>CONFLICT</C>, "409", "A unique constraint was violated (e.g., duplicate value on a unique field)."],
            [<C>UNAUTHORIZED</C>, "401", "No valid authentication token was provided or the token has expired."],
            [<C>FORBIDDEN</C>, "403", "The authenticated user does not have permission for this action on this resource."],
            [<C>INTERNAL_ERROR</C>, "500", "An unexpected server error occurred. Check server logs for details."],
          ]}
        />
      </Section>

      {/* ── Error Response Format ── */}
      <Section title="Error Response Format" id="error-response-format">
        <p>
          Every error response wraps the error information in an <C>error</C> envelope with a
          consistent structure:
        </p>
        <CodeBlock language="json" title="Error response example">{`{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed for entity 'invoice'",
    "details": [
      {
        "field": "amount",
        "rule": "required",
        "message": "amount is required"
      },
      {
        "field": "status",
        "rule": "enum",
        "message": "status must be one of: draft, sent, paid, cancelled"
      }
    ]
  }
}`}</CodeBlock>
        <p>
          The <C>details</C> array is present only for validation errors. For other error codes,
          the response contains just the <C>code</C> and <C>message</C> fields:
        </p>
        <CodeBlock language="json" title="Non-validation error example">{`{
  "error": {
    "code": "NOT_FOUND",
    "message": "Record not found"
  }
}`}</CodeBlock>
      </Section>
    </div>
  );
}
