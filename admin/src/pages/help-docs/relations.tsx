import { Section, CodeBlock, PropsTable, InfoBox, EndpointBlock, C } from "./help-components";

export default function RelationsHelp() {
  return (
    <div>
      {/* ── Overview ── */}
      <Section title="Overview" id="overview">
        <p>
          Relations define associations between entities. They tell the engine how two tables are
          connected, enabling you to <strong>load related data</strong> via includes and
          <strong> write parent + child records</strong> in a single request via nested writes.
        </p>
        <p style={{ "margin-top": "0.75rem" }}>
          Rocket supports three relation types:
        </p>
        <ul class="help-list">
          <li><C>one_to_many</C> -- one parent has many children (e.g., Customer has many Invoices)</li>
          <li><C>many_to_many</C> -- both sides can have many of the other (e.g., Product has many Tags)</li>
          <li><C>one_to_one</C> -- each record on one side maps to exactly one on the other (e.g., User has one Profile)</li>
        </ul>
        <InfoBox type="note">
          <p>
            Relations are metadata-only. When you create a relation, the engine uses existing foreign
            key columns or join tables -- it does not alter your database schema. Make sure the
            referenced columns and tables already exist before defining a relation.
          </p>
        </InfoBox>
      </Section>

      {/* ── Relation Types ── */}
      <Section title="Relation Types" id="relation-types">
        <h3>One-to-Many</h3>
        <p>
          The most common relation. The <strong>child</strong> table holds a foreign key pointing back
          to the <strong>parent</strong>. Think of a Customer who has many Invoices -- each Invoice row
          stores a <C>customer_id</C> column.
        </p>

        <h3 style={{ "margin-top": "1rem" }}>Many-to-Many</h3>
        <p>
          Both sides can reference many of the other. A <strong>join table</strong> sits in the middle
          holding two foreign keys. Think of a Product that can have many Tags, and each Tag can appear
          on many Products -- a <C>product_tags</C> table links them.
        </p>

        <h3 style={{ "margin-top": "1rem" }}>One-to-One</h3>
        <p>
          Each record on the source side maps to at most one record on the target side. Think of a User
          who has exactly one Profile. Structurally it works like one-to-many but the engine enforces
          the single-record constraint.
        </p>
      </Section>

      {/* ── Relation Definition ── */}
      <Section title="Relation Definition" id="relation-definition">
        <p>
          Relations are created via the Admin API or the Admin UI. Below is the full JSON structure
          for a <C>one_to_many</C> relation with all available properties:
        </p>
        <CodeBlock language="json" title="Full relation definition (one_to_many)">{`{
  "name": "items",
  "type": "one_to_many",
  "source": "invoice",
  "target": "invoice_item",
  "source_key": "id",
  "target_key": "invoice_id",
  "ownership": "source",
  "on_delete": "cascade",
  "fetch": "lazy",
  "write_mode": "diff"
}`}</CodeBlock>
      </Section>

      {/* ── Relation Properties ── */}
      <Section title="Relation Properties" id="relation-properties">
        <PropsTable
          columns={["Property", "Type", "Description"]}
          rows={[
            [<C>name</C>, "string", "Unique name for the relation. Used in include parameters and nested write payloads."],
            [<C>type</C>, "string", "One of: one_to_many, many_to_many, one_to_one."],
            [<C>source</C>, "string", "The parent entity name (the side that \"owns\" or initiates the relation)."],
            [<C>target</C>, "string", "The child or related entity name."],
            [<C>source_key</C>, "string", "Column on the source table used for the join. Usually \"id\"."],
            [<C>target_key</C>, "string", "Column on the target table that references the source. For one_to_many this is the FK column (e.g., \"invoice_id\")."],
            [<C>join_table</C>, "string", "Many-to-many only. Name of the join table that links the two entities."],
            [<C>source_join_key</C>, "string", "Many-to-many only. Column in the join table referencing the source entity."],
            [<C>target_join_key</C>, "string", "Many-to-many only. Column in the join table referencing the target entity."],
            [<C>ownership</C>, "string", "Who owns the relationship: \"source\", \"target\", or \"none\". Affects cascade behavior."],
            [<C>on_delete</C>, "string", "What happens to related records on delete: cascade, set_null, restrict, or detach."],
            [<C>fetch</C>, "string", "\"lazy\" (load only when included) or \"eager\" (always load). Default: lazy."],
            [<C>write_mode</C>, "string", "How nested writes are applied: \"diff\" (merge changes), \"replace\" (full replacement), or \"append\" (add only)."],
          ]}
        />
      </Section>

      {/* ── One-to-Many Example ── */}
      <Section title="One-to-Many Example" id="one-to-many-example">
        <p>
          An Invoice has many InvoiceItems. The <C>invoice_item</C> table has an <C>invoice_id</C> foreign
          key column. When you include <C>items</C> on an invoice query, the engine loads all
          invoice_item rows matching that invoice's ID.
        </p>
        <CodeBlock language="json" title="Invoice -> InvoiceItems relation">{`{
  "name": "items",
  "type": "one_to_many",
  "source": "invoice",
  "target": "invoice_item",
  "source_key": "id",
  "target_key": "invoice_id",
  "ownership": "source",
  "on_delete": "cascade",
  "fetch": "lazy",
  "write_mode": "diff"
}`}</CodeBlock>
        <p style={{ "margin-top": "0.75rem" }}>
          With this relation defined, you can load an invoice with its items:
        </p>
        <CodeBlock language="bash">{`GET /api/myapp/invoice/inv-001?include=items`}</CodeBlock>
      </Section>

      {/* ── Many-to-Many Example ── */}
      <Section title="Many-to-Many Example" id="many-to-many-example">
        <p>
          A Product can have many Tags, and a Tag can be applied to many Products. This requires a
          join table (<C>product_tags</C>) with two foreign key columns.
        </p>
        <CodeBlock language="json" title="Product -> Tags relation (many-to-many)">{`{
  "name": "tags",
  "type": "many_to_many",
  "source": "product",
  "target": "tag",
  "source_key": "id",
  "target_key": "id",
  "join_table": "product_tags",
  "source_join_key": "product_id",
  "target_join_key": "tag_id",
  "ownership": "none",
  "on_delete": "detach",
  "fetch": "lazy",
  "write_mode": "replace"
}`}</CodeBlock>
        <InfoBox type="tip">
          <p>
            For many-to-many relations, <C>source_key</C> and <C>target_key</C> typically refer
            to the primary keys of each entity, while <C>source_join_key</C> and <C>target_join_key</C> are
            the columns in the join table.
          </p>
        </InfoBox>
      </Section>

      {/* ── One-to-One Example ── */}
      <Section title="One-to-One Example" id="one-to-one-example">
        <p>
          A User has exactly one Profile. The <C>profile</C> table stores a <C>user_id</C> foreign
          key. Structurally similar to one-to-many, but the engine treats it as a singular value
          rather than an array.
        </p>
        <CodeBlock language="json" title="User -> Profile relation (one-to-one)">{`{
  "name": "profile",
  "type": "one_to_one",
  "source": "user",
  "target": "profile",
  "source_key": "id",
  "target_key": "user_id",
  "ownership": "source",
  "on_delete": "cascade",
  "fetch": "lazy",
  "write_mode": "diff"
}`}</CodeBlock>
        <p style={{ "margin-top": "0.75rem" }}>
          When included, a one-to-one relation returns a single object instead of an array:
        </p>
        <CodeBlock language="json" title="Response with one-to-one include">{`{
  "data": {
    "id": "usr-001",
    "email": "alice@example.com",
    "profile": {
      "id": "prof-001",
      "bio": "Software engineer",
      "avatar_url": "/avatars/alice.png"
    }
  }
}`}</CodeBlock>
      </Section>

      {/* ── Cascade Policies ── */}
      <Section title="Cascade Policies" id="cascade-policies">
        <p>
          The <C>on_delete</C> property controls what happens to related records when a parent is deleted:
        </p>
        <PropsTable
          columns={["Policy", "Behavior"]}
          rows={[
            [<C>cascade</C>, "Delete all child records when the parent is deleted. Use for owned children that have no meaning without their parent (e.g., invoice items)."],
            [<C>set_null</C>, "Set the foreign key column on child records to NULL. The child records remain but are no longer linked. Use when children can exist independently."],
            [<C>restrict</C>, "Prevent the parent from being deleted if any child records exist. The delete request will return an error. Use when child records must be explicitly handled first."],
            [<C>detach</C>, "Remove the foreign key reference but keep the child record intact. Similar to set_null but used for join table cleanup in many-to-many relations."],
          ]}
        />
        <InfoBox type="tip" title="Choosing a cascade policy">
          <p>
            Use <C>cascade</C> when children are meaningless without the parent (invoice items, order lines).
            Use <C>restrict</C> when you want to force the user to handle children first (customers with active orders).
            Use <C>set_null</C> when children should survive but lose their link (articles losing their author reference).
            Use <C>detach</C> for many-to-many cleanup where both sides remain valid independently.
          </p>
        </InfoBox>
      </Section>

      {/* ── Loading Related Data ── */}
      <Section title="Loading Related Data" id="loading-related-data">
        <p>
          Use the <C>include</C> query parameter to load related data alongside the primary entity.
          Pass one or more relation names as a comma-separated list:
        </p>
        <CodeBlock language="bash">{`GET /api/myapp/invoice?include=items,customer`}</CodeBlock>
        <p style={{ "margin-top": "0.75rem" }}>
          The engine executes <strong>separate queries</strong> for each included relation rather than
          using SQL JOINs. This avoids cartesian explosions when including multiple one-to-many
          relations -- a single invoice with 10 items and 3 payments would produce 30 rows with a JOIN
          but only 1 + 10 + 3 = 14 rows with separate queries.
        </p>
        <CodeBlock language="json" title="Response with includes">{`{
  "data": {
    "id": "inv-001",
    "total": 1500,
    "status": "sent",
    "items": [
      { "id": "item-001", "description": "Widget A", "amount": 1000 },
      { "id": "item-002", "description": "Widget B", "amount": 500 }
    ],
    "customer": {
      "id": "cust-001",
      "name": "Acme Corp",
      "email": "billing@acme.com"
    }
  }
}`}</CodeBlock>
        <InfoBox type="note">
          <p>
            Includes work on both list and single-record endpoints. On list endpoints, the engine
            batches the related queries for all returned records to avoid N+1 query problems.
          </p>
        </InfoBox>
      </Section>
    </div>
  );
}
