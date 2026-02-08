import { Section, CodeBlock, PropsTable, InfoBox, C } from "./help-components";

export default function PermissionsHelp() {
  return (
    <div>
      {/* ── Overview ── */}
      <Section title="Overview" id="overview">
        <p>
          Permissions in Rocket Backend are <strong>metadata-driven authorization policies</strong>{" "}
          stored in the <C>_permissions</C> table. They follow a <strong>whitelist model</strong>:
          nothing is allowed by default. If no permission row matches a request, the user receives
          a <C>403 Forbidden</C> response.
        </p>
        <p style={{ "margin-top": "0.75rem" }}>
          Users with the <C>admin</C> role bypass all permission checks entirely, including access to
          all <C>_admin</C> endpoints. For every other user, you must explicitly grant access to each
          entity and action combination.
        </p>
      </Section>

      {/* ── Permission Definition ── */}
      <Section title="Permission Definition" id="permission-definition">
        <p>
          Below is the full JSON structure for a permission with all available properties:
        </p>
        <CodeBlock language="json" title="Full permission definition">{`{
  "entity": "invoice",
  "action": "read",
  "roles": ["accountant", "manager"],
  "conditions": {
    "status": { "in": ["draft", "sent", "paid"] }
  }
}`}</CodeBlock>
        <p style={{ "margin-top": "0.75rem" }}>
          The <C>entity</C> and <C>action</C> fields determine which requests this permission
          applies to. The <C>roles</C> array lists which user roles are granted access.
          The <C>conditions</C> object is optional -- when present, it adds row-level filtering
          for reads or record-level checks for writes.
        </p>
      </Section>

      {/* ── The Whitelist Model ── */}
      <Section title="The Whitelist Model" id="whitelist-model">
        <p>
          Unlike blacklist systems where everything is allowed unless explicitly denied, Rocket
          Backend's whitelist model means <strong>nothing is allowed unless explicitly granted</strong>.
          Every entity + action combination requires at least one permission row for non-admin users
          to access it.
        </p>
        <p style={{ "margin-top": "0.75rem" }}>
          This is a deliberate security choice: it is safer to forget to add a permission (result:
          users are locked out, which is noticeable and fixable) than to forget to add a restriction
          (result: users have access they should not have, which is a silent vulnerability).
        </p>
        <InfoBox type="important">
          <p>
            Forgetting to create a permission row means users get <C>403 Forbidden</C> on that
            entity + action. If your users report access denied errors, the first thing to check is
            whether a matching permission row exists.
          </p>
        </InfoBox>
      </Section>

      {/* ── Actions ── */}
      <Section title="Actions" id="actions">
        <p>
          There are four actions, each corresponding to one or more REST endpoints. Each action needs
          its own permission row(s):
        </p>
        <PropsTable
          columns={["Action", "Endpoints", "Description"]}
          rows={[
            [<C>read</C>, <><C>GET /:entity</C>, <C>GET /:entity/:id</C></>, "List and get-by-ID. Conditions are injected as WHERE clauses (row-level security)."],
            [<C>create</C>, <C>POST /:entity</C>, "Create a new record. Conditions are not applicable (there is no existing record to check)."],
            [<C>update</C>, <C>PUT /:entity/:id</C>, "Update an existing record. Conditions check the current record before allowing the update."],
            [<C>delete</C>, <C>DELETE /:entity/:id</C>, "Delete a record. Conditions check the current record before allowing the delete."],
          ]}
        />
        <InfoBox type="note">
          <p>
            You can create multiple permission rows for the same entity + action with different roles
            and conditions. If <strong>any</strong> matching permission passes, the request is allowed.
          </p>
        </InfoBox>
      </Section>

      {/* ── Role-Based Access ── */}
      <Section title="Role-Based Access" id="role-based-access">
        <p>
          Each permission row specifies a <C>roles</C> array. For the permission to apply, the
          authenticated user must have <strong>at least one role</strong> that appears in the
          permission's roles array. Roles are stored in the <C>roles</C> column of the <C>_users</C>{" "}
          table as a text array.
        </p>
        <CodeBlock language="json" title="Permission granting read access to two roles">{`{
  "entity": "product",
  "action": "read",
  "roles": ["viewer", "editor"]
}`}</CodeBlock>
        <p style={{ "margin-top": "0.75rem" }}>
          A user with roles <C>["viewer"]</C> matches. A user with roles <C>["editor", "manager"]</C>{" "}
          also matches (because "editor" is in the permission's roles). A user with roles{" "}
          <C>["guest"]</C> does not match.
        </p>
        <InfoBox type="tip">
          <p>
            Design your roles around business functions (e.g., "accountant", "warehouse_staff",
            "sales") rather than technical levels (e.g., "level1", "level2"). This makes permissions
            easier to reason about and audit.
          </p>
        </InfoBox>
      </Section>

      {/* ── Read Permissions: Row-Level Security ── */}
      <Section title="Read Permissions: Row-Level Security" id="row-level-security">
        <p>
          For <C>read</C> actions, conditions are <strong>injected as WHERE clauses</strong> into the
          SQL query. This means users do not receive a 403 -- instead, they simply <strong>only see
          rows that match the conditions</strong>. Rows that do not match are invisible to them.
        </p>
        <CodeBlock language="json" title="Accountants can only see draft, sent, and paid invoices">{`{
  "entity": "invoice",
  "action": "read",
  "roles": ["accountant"],
  "conditions": {
    "status": { "in": ["draft", "sent", "paid"] }
  }
}`}</CodeBlock>
        <p style={{ "margin-top": "0.75rem" }}>
          When an accountant queries <C>GET /api/myapp/invoice</C>, the engine translates the
          condition into a SQL WHERE clause:
        </p>
        <CodeBlock language="sql" title="Generated SQL filter">{`SELECT * FROM invoice
WHERE deleted_at IS NULL
  AND status IN ('draft', 'sent', 'paid')
ORDER BY created_at DESC
LIMIT 25`}</CodeBlock>
        <p style={{ "margin-top": "0.75rem" }}>
          Invoices with status "cancelled" or "void" are simply absent from the result set. The
          accountant has no way to access or even know about them. This is true row-level security --
          the filtering happens at the database level, not in application code.
        </p>
        <InfoBox type="note">
          <p>
            If multiple read permissions match (different roles or conditions), their conditions are
            combined with OR logic. The user sees rows matching <strong>any</strong> of the applicable
            permission conditions.
          </p>
        </InfoBox>
      </Section>

      {/* ── Write Permissions: Record Conditions ── */}
      <Section title="Write Permissions: Record Conditions" id="write-conditions">
        <p>
          For <C>update</C> and <C>delete</C> actions, conditions check the <strong>current
          record</strong> in the database before allowing the operation. Unlike read conditions
          (which filter results), write conditions either allow or deny the request outright.
        </p>
        <CodeBlock language="json" title="Users can only update invoices in draft status">{`{
  "entity": "invoice",
  "action": "update",
  "roles": ["accountant"],
  "conditions": {
    "status": { "eq": "draft" }
  }
}`}</CodeBlock>
        <p style={{ "margin-top": "0.75rem" }}>
          The evaluation flow for write conditions:
        </p>
        <ol class="help-list">
          <li>The engine fetches the current record from the database</li>
          <li>It evaluates the condition against the current record's field values</li>
          <li>If the condition passes, the update/delete proceeds</li>
          <li>If the condition fails, the user receives a <C>403 Forbidden</C> response</li>
        </ol>
        <p style={{ "margin-top": "0.75rem" }}>
          In this example, an accountant can update an invoice that is currently in "draft" status.
          If the invoice has already moved to "sent" or "paid", the update is denied.
        </p>
      </Section>

      {/* ── Permission Evaluation Flow ── */}
      <Section title="Permission Evaluation Flow" id="evaluation-flow">
        <p>
          When a request arrives, the engine evaluates permissions in this order:
        </p>
        <ol class="help-list">
          <li>
            <strong>Authentication check</strong> -- Is the user authenticated? If not, return{" "}
            <C>401 Unauthorized</C>.
          </li>
          <li>
            <strong>Admin role check</strong> -- Does the user have the <C>admin</C> role? If yes,
            allow immediately. No further checks needed.
          </li>
          <li>
            <strong>Find matching permissions</strong> -- Query <C>_permissions</C> for rows matching
            the entity and action.
          </li>
          <li>
            <strong>Role intersection</strong> -- Filter to permissions where the user's roles
            overlap with the permission's roles array.
          </li>
          <li>
            <strong>Condition evaluation</strong> -- For permissions with conditions, evaluate them
            against the record (read: WHERE clause injection; write: current record check).
          </li>
          <li>
            <strong>Final decision</strong> -- If <strong>any</strong> matching permission passes,
            allow the request. If <strong>none</strong> pass, return <C>403 Forbidden</C>.
          </li>
        </ol>
        <InfoBox type="tip">
          <p>
            The "any passes" rule means you can create overlapping permissions for different roles
            with different conditions. A manager might see all invoices while an accountant only sees
            certain statuses -- both permissions coexist.
          </p>
        </InfoBox>
      </Section>

      {/* ── Condition Operators ── */}
      <Section title="Condition Operators" id="condition-operators">
        <p>
          Permission conditions use the same operator set as field rules and query filters:
        </p>
        <PropsTable
          columns={["Operator", "Description", "Example"]}
          rows={[
            [<C>eq</C>, "Equal to", <C>{`{ "status": { "eq": "active" } }`}</C>],
            [<C>neq</C>, "Not equal to", <C>{`{ "status": { "neq": "archived" } }`}</C>],
            [<C>gt</C>, "Greater than", <C>{`{ "amount": { "gt": 0 } }`}</C>],
            [<C>gte</C>, "Greater than or equal to", <C>{`{ "priority": { "gte": 3 } }`}</C>],
            [<C>lt</C>, "Less than", <C>{`{ "quantity": { "lt": 100 } }`}</C>],
            [<C>lte</C>, "Less than or equal to", <C>{`{ "discount": { "lte": 50 } }`}</C>],
            [<C>in</C>, "Value is in the given list", <C>{`{ "status": { "in": ["draft", "sent"] } }`}</C>],
            [<C>not_in</C>, "Value is not in the given list", <C>{`{ "status": { "not_in": ["deleted", "void"] } }`}</C>],
            [<C>like</C>, "SQL LIKE pattern match", <C>{`{ "name": { "like": "%Corp%" } }`}</C>],
          ]}
        />
      </Section>

      {/* ── Admin Role Bypass ── */}
      <Section title="Admin Role Bypass" id="admin-bypass">
        <p>
          Users with the <C>admin</C> role bypass <strong>all</strong> permission checks. This
          includes:
        </p>
        <ul class="help-list">
          <li>All dynamic entity endpoints (list, get, create, update, delete)</li>
          <li>All <C>_admin</C> endpoints (entities, relations, rules, users, permissions, etc.)</li>
          <li>All workflow runtime endpoints (approve, reject, list pending)</li>
          <li>File management endpoints (upload, delete, list)</li>
        </ul>
        <p style={{ "margin-top": "0.75rem" }}>
          No permission rows are needed for admin users. The admin bypass is checked early in the
          evaluation flow (step 2), so admin requests skip all permission lookups entirely.
        </p>
        <InfoBox type="warning">
          <p>
            Grant the <C>admin</C> role sparingly. Admin users have unrestricted access to
            everything, including the ability to modify metadata, manage users, and delete records
            across all entities. For most users, define specific roles with scoped permissions.
          </p>
        </InfoBox>
      </Section>

      {/* ── Managing Users ── */}
      <Section title="Managing Users" id="managing-users">
        <p>
          Users are managed via the Admin API or the Admin UI. Each app is seeded with a default
          admin user on creation:
        </p>
        <PropsTable
          columns={["Field", "Value"]}
          rows={[
            ["Email", <C>admin@localhost</C>],
            ["Password", <C>changeme</C>],
            ["Roles", <C>["admin"]</C>],
          ]}
        />
        <p style={{ "margin-top": "0.75rem" }}>
          Create additional users through the Admin UI's <strong>Users</strong> page or via the API:
        </p>
        <CodeBlock language="json" title="Create a user via the Admin API">{`POST /api/myapp/_admin/users

{
  "email": "alice@example.com",
  "password": "secure-password-here",
  "roles": ["accountant", "viewer"],
  "active": true
}`}</CodeBlock>
        <InfoBox type="note">
          <p>
            Passwords are hashed with bcrypt before storage and are <strong>never returned</strong>{" "}
            in API responses. The <C>password_hash</C> field is always omitted from user queries.
          </p>
        </InfoBox>
      </Section>

      {/* ── Complete Example ── */}
      <Section title="Complete Example" id="complete-example">
        <p>
          Here is a full permission setup for a <strong>product catalog</strong> with three roles:
          viewer (read-only), editor (create and update), and admin (full access via role bypass).
        </p>

        <h3>1. Read: Everyone can browse products</h3>
        <p>
          Grant read access to all non-admin roles. No conditions -- every user sees every product.
        </p>
        <CodeBlock language="json" title="Read permission for all users">{`{
  "entity": "product",
  "action": "read",
  "roles": ["viewer", "editor"]
}`}</CodeBlock>

        <h3 style={{ "margin-top": "1.5rem" }}>2. Create: Editors can add new products</h3>
        <p>
          Only editors (and admins, who bypass checks) can create products.
        </p>
        <CodeBlock language="json" title="Create permission for editors">{`{
  "entity": "product",
  "action": "create",
  "roles": ["editor"]
}`}</CodeBlock>

        <h3 style={{ "margin-top": "1.5rem" }}>3. Update: Editors can update, but only active products</h3>
        <p>
          Editors can update products, but only if the product is currently in "active" status.
          Archived or discontinued products cannot be edited by non-admins.
        </p>
        <CodeBlock language="json" title="Update permission for editors (active products only)">{`{
  "entity": "product",
  "action": "update",
  "roles": ["editor"],
  "conditions": {
    "status": { "eq": "active" }
  }
}`}</CodeBlock>

        <h3 style={{ "margin-top": "1.5rem" }}>4. Delete: Admins only</h3>
        <p>
          No explicit delete permission is needed because only admin users should delete products,
          and admin role bypasses all checks. By not creating a delete permission row, the whitelist
          model ensures non-admin users are denied.
        </p>
        <InfoBox type="tip" title="Implicit deny via whitelist">
          <p>
            Notice that we did not create a "deny delete" rule. The whitelist model handles this
            automatically: since there is no delete permission row for any non-admin role, all delete
            requests from non-admin users return <C>403 Forbidden</C>. This is the power of the
            whitelist approach -- security by default.
          </p>
        </InfoBox>
      </Section>
    </div>
  );
}
