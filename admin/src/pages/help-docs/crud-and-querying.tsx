import { Section, CodeBlock, PropsTable, InfoBox, EndpointBlock, C } from "./help-components";

export default function CrudAndQueryingHelp() {
  return (
    <div>
      {/* ── Overview ── */}
      <Section title="Overview" id="overview">
        <p>
          Every entity you define in Rocket automatically gets five REST endpoints. There is no code
          generation -- the engine interprets your entity metadata at runtime and serves fully
          functional CRUD operations immediately. Define an entity via the Admin API or Admin UI,
          and its endpoints are live.
        </p>
      </Section>

      {/* ── The Five Endpoints ── */}
      <Section title="The Five Endpoints" id="five-endpoints">
        <EndpointBlock method="GET" url="/api/:app/:entity" description="List with filters, sorting, pagination, includes" />
        <EndpointBlock method="GET" url="/api/:app/:entity/:id" description="Get by ID with optional includes" />
        <EndpointBlock method="POST" url="/api/:app/:entity" description="Create a record (with optional nested writes)" />
        <EndpointBlock method="PUT" url="/api/:app/:entity/:id" description="Update a record (with optional nested writes)" />
        <EndpointBlock method="DELETE" url="/api/:app/:entity/:id" description="Soft or hard delete" />
        <InfoBox type="note">
          <p>
            All endpoints require authentication (JWT bearer token) unless the entity is explicitly
            configured otherwise. The token must be passed in the <C>Authorization</C> header.
          </p>
        </InfoBox>
      </Section>

      {/* ── Creating Records ── */}
      <Section title="Creating Records" id="creating-records">
        <p>
          Send a <C>POST</C> request with a JSON body containing the field values. The engine
          validates required fields, checks enum constraints, runs any active rules, and inserts the
          record inside a transaction.
        </p>
        <CodeBlock language="bash" title="Create a customer">{`curl -X POST http://localhost:8080/api/myapp/customer \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Acme Corp",
    "email": "contact@acme.com",
    "status": "active"
  }'`}</CodeBlock>
        <CodeBlock language="json" title="Response (201 Created)">{`{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Acme Corp",
    "email": "contact@acme.com",
    "status": "active",
    "created_at": "2025-01-15T10:30:00Z",
    "updated_at": "2025-01-15T10:30:00Z"
  }
}`}</CodeBlock>
      </Section>

      {/* ── Getting Records ── */}
      <Section title="Getting Records" id="getting-records">
        <p>
          Fetch a single record by its ID. Optionally include related data using the <C>include</C> query
          parameter.
        </p>
        <CodeBlock language="bash" title="Get a customer by ID">{`curl http://localhost:8080/api/myapp/customer/550e8400-e29b-41d4-a716-446655440000 \\
  -H "Authorization: Bearer <token>"`}</CodeBlock>
        <CodeBlock language="json" title="Response (200 OK)">{`{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Acme Corp",
    "email": "contact@acme.com",
    "status": "active",
    "created_at": "2025-01-15T10:30:00Z",
    "updated_at": "2025-01-15T10:30:00Z"
  }
}`}</CodeBlock>
      </Section>

      {/* ── Filtering ── */}
      <Section title="Filtering" id="filtering">
        <p>
          Use query parameters with the <C>filter</C> prefix to narrow down list results. The basic
          syntax is <C>filter[field]=value</C> for exact equality. For other comparison operators, use
          the dot syntax: <C>filter[field.op]=value</C>.
        </p>
        <PropsTable
          columns={["Operator", "Syntax", "Description"]}
          rows={[
            [<C>eq</C>, <C>filter[status]=active</C>, "Equal to (default when no operator specified)"],
            [<C>neq</C>, <C>filter[status.neq]=archived</C>, "Not equal to"],
            [<C>gt</C>, <C>filter[total.gt]=1000</C>, "Greater than"],
            [<C>gte</C>, <C>filter[total.gte]=1000</C>, "Greater than or equal to"],
            [<C>lt</C>, <C>filter[total.lt]=500</C>, "Less than"],
            [<C>lte</C>, <C>filter[total.lte]=500</C>, "Less than or equal to"],
            [<C>in</C>, <C>filter[status.in]=draft,sent</C>, "Value is one of (comma-separated list)"],
            [<C>not_in</C>, <C>filter[status.not_in]=archived,deleted</C>, "Value is not one of (comma-separated list)"],
            [<C>like</C>, <C>filter[name.like]=%acme%</C>, "SQL LIKE pattern match (use % as wildcard)"],
          ]}
        />
        <CodeBlock language="bash" title="Filtering examples">{`# Exact match
GET /api/myapp/invoice?filter[status]=sent

# Numeric comparison
GET /api/myapp/invoice?filter[total.gte]=1000

# Multiple values
GET /api/myapp/invoice?filter[status.in]=draft,sent

# Combine multiple filters (AND logic)
GET /api/myapp/invoice?filter[status]=sent&filter[total.gte]=500`}</CodeBlock>
        <InfoBox type="tip">
          <p>
            Multiple filters are combined with AND logic. If you specify
            both <C>filter[status]=sent</C> and <C>filter[total.gte]=500</C>, only records matching
            both conditions are returned.
          </p>
        </InfoBox>
      </Section>

      {/* ── Sorting ── */}
      <Section title="Sorting" id="sorting">
        <p>
          Use the <C>sort</C> query parameter to order results. Pass one or more field names separated
          by commas. Prefix a field name with <C>-</C> (minus) for descending order.
        </p>
        <CodeBlock language="bash" title="Sorting examples">{`# Sort by created_at ascending (oldest first)
GET /api/myapp/invoice?sort=created_at

# Sort by total descending (highest first)
GET /api/myapp/invoice?sort=-total

# Multi-field sort: status ascending, then total descending
GET /api/myapp/invoice?sort=status,-total`}</CodeBlock>
      </Section>

      {/* ── Pagination ── */}
      <Section title="Pagination" id="pagination">
        <p>
          Control result pages with <C>page</C> and <C>per_page</C> query parameters. Pages are
          1-indexed. The maximum value for <C>per_page</C> is 100; the default is 25.
        </p>
        <CodeBlock language="bash" title="Pagination example">{`GET /api/myapp/invoice?page=2&per_page=10`}</CodeBlock>
        <p style={{ "margin-top": "0.75rem" }}>
          List responses include a <C>pagination</C> object with metadata about the current page:
        </p>
        <CodeBlock language="json" title="Pagination metadata in response">{`{
  "data": [ ... ],
  "pagination": {
    "page": 2,
    "per_page": 10,
    "total": 47,
    "total_pages": 5
  }
}`}</CodeBlock>
      </Section>

      {/* ── Including Related Data ── */}
      <Section title="Including Related Data" id="including-related-data">
        <p>
          Use the <C>include</C> query parameter to load related entities alongside the primary record.
          Pass relation names as a comma-separated list. Relations must be defined in the metadata
          before they can be included.
        </p>
        <CodeBlock language="bash" title="Include related data">{`# Single include
GET /api/myapp/invoice/inv-001?include=items

# Multiple includes
GET /api/myapp/invoice/inv-001?include=items,customer`}</CodeBlock>
        <CodeBlock language="json" title="Invoice with items included">{`{
  "data": {
    "id": "inv-001",
    "total": 1500,
    "status": "sent",
    "items": [
      { "id": "item-001", "description": "Widget A", "amount": 1000 },
      { "id": "item-002", "description": "Widget B", "amount": 500 }
    ]
  }
}`}</CodeBlock>
        <InfoBox type="note">
          <p>
            Includes use separate queries instead of SQL JOINs. This avoids cartesian explosions
            when multiple one-to-many relations are included. On list endpoints, related queries are
            batched across all returned records to prevent N+1 performance issues.
          </p>
        </InfoBox>
      </Section>

      {/* ── Response Format ── */}
      <Section title="Response Format" id="response-format">
        <p>
          All successful responses wrap data in a <C>data</C> envelope:
        </p>
        <CodeBlock language="json" title="Single record response">{`{
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Acme Corp",
    "email": "contact@acme.com"
  }
}`}</CodeBlock>
        <CodeBlock language="json" title="List response with pagination">{`{
  "data": [
    { "id": "cust-001", "name": "Acme Corp" },
    { "id": "cust-002", "name": "Globex Inc" }
  ],
  "pagination": {
    "page": 1,
    "per_page": 25,
    "total": 2,
    "total_pages": 1
  }
}`}</CodeBlock>
      </Section>

      {/* ── Error Format ── */}
      <Section title="Error Format" id="error-format">
        <p>
          All error responses follow a standard format with a code, human-readable message, and
          optional field-level details:
        </p>
        <CodeBlock language="json" title="Error response example">{`{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed for entity 'customer'",
    "details": [
      {
        "field": "email",
        "rule": "required",
        "message": "email is required"
      },
      {
        "field": "status",
        "rule": "enum",
        "message": "status must be one of: active, inactive, archived"
      }
    ]
  }
}`}</CodeBlock>
        <PropsTable
          columns={["Error Code", "HTTP Status", "Description"]}
          rows={[
            [<C>UNKNOWN_ENTITY</C>, "404", "The entity name in the URL does not match any defined entity."],
            [<C>NOT_FOUND</C>, "404", "The record with the given ID does not exist (or has been soft-deleted)."],
            [<C>VALIDATION_FAILED</C>, "422", "One or more fields failed validation. Check the details array for specifics."],
            [<C>UNKNOWN_FIELD</C>, "400", "The request body contains a field name not defined in the entity schema."],
            [<C>INVALID_PAYLOAD</C>, "400", "The request body is malformed or missing required structure."],
            [<C>CONFLICT</C>, "409", "A unique constraint violation occurred (e.g., duplicate email)."],
            [<C>UNAUTHORIZED</C>, "401", "No valid authentication token was provided."],
            [<C>FORBIDDEN</C>, "403", "The authenticated user does not have permission for this action."],
            [<C>INTERNAL_ERROR</C>, "500", "An unexpected server error occurred. Check server logs for details."],
          ]}
        />
      </Section>
    </div>
  );
}
