import { Section, CodeBlock, InfoBox, PropsTable, C } from "./help-components";

export default function Entities() {
  return (
    <div>
      <Section title="Overview" id="overview">
        <p>
          An <strong>entity</strong> maps directly to a PostgreSQL table. You define it via the
          Admin API or the Admin UI — specifying the table name, primary key, fields, and optional
          soft delete behavior. When you create or update an entity, the engine's{" "}
          <strong>auto-migrator</strong> automatically issues the necessary{" "}
          <C>CREATE TABLE</C> or <C>ALTER TABLE ADD COLUMN</C> statements.
        </p>
        <p>
          Once an entity is defined, five REST endpoints become available instantly:{" "}
          <C>GET</C> (list), <C>GET /:id</C> (get), <C>POST</C> (create), <C>PUT /:id</C>{" "}
          (update), and <C>DELETE /:id</C> (delete). No code needs to be written or generated.
        </p>
      </Section>

      <Section title="Entity Structure" id="entity-structure">
        <p>
          An entity definition is a JSON object with a name, primary key configuration, optional
          soft delete settings, and an array of field definitions:
        </p>
        <CodeBlock language="json" title="Full entity definition structure">
{`{
  "name": "invoice",
  "table_name": "invoice",
  "primary_key": {
    "field": "id",
    "type": "uuid",
    "generated": true
  },
  "soft_delete": {
    "enabled": true,
    "field": "deleted_at"
  },
  "fields": [
    { "name": "invoice_number", "type": "string", "required": true, "unique": true },
    { "name": "customer_id", "type": "uuid", "required": true },
    { "name": "status", "type": "string", "enum": ["draft", "sent", "paid", "cancelled"], "default": "draft" },
    { "name": "amount", "type": "decimal", "precision": 2, "required": true },
    { "name": "notes", "type": "text" },
    { "name": "due_date", "type": "date" },
    { "name": "metadata", "type": "json" },
    { "name": "created_at", "type": "timestamp", "auto": "create" },
    { "name": "updated_at", "type": "timestamp", "auto": "update" }
  ]
}`}
        </CodeBlock>
        <InfoBox type="note">
          <p>
            The <C>table_name</C> field is optional. If omitted, it defaults to the entity name.
            The <C>name</C> is what you use in API URLs and relation definitions.
          </p>
        </InfoBox>
      </Section>

      <Section title="Primary Key Configuration" id="primary-key">
        <p>
          Every entity requires a primary key. The primary key configuration specifies the column
          name, data type, and whether the database generates the value automatically.
        </p>
        <PropsTable
          columns={["Property", "Type", "Description"]}
          rows={[
            [<C>field</C>, "string", <>Column name for the primary key. Almost always <C>"id"</C>.</>],
            [<C>type</C>, <><C>"uuid"</C> | <C>"int"</C> | <C>"bigint"</C> | <C>"string"</C></>, "Data type of the primary key column."],
            [<C>generated</C>, "boolean", <>When <C>true</C>, the database auto-generates the value (UUID v4 for uuid, serial for int/bigint).</>],
          ]}
        />
        <InfoBox type="tip" title="Recommended: UUID with generated=true">
          <p>
            The most common configuration is <C>{`{"field": "id", "type": "uuid", "generated": true}`}</C>.
            This gives you globally unique, non-sequential identifiers that work well for
            distributed systems and avoid exposing record counts.
          </p>
        </InfoBox>
        <CodeBlock language="json" title="Integer primary key (auto-increment)">
{`{
  "field": "id",
  "type": "int",
  "generated": true
}`}
        </CodeBlock>
        <CodeBlock language="json" title="String primary key (caller-provided)">
{`{
  "field": "code",
  "type": "string",
  "generated": false
}`}
        </CodeBlock>
      </Section>

      <Section title="Field Types" id="field-types">
        <p>
          Rocket Backend supports 11 field types. Each maps to a specific PostgreSQL column type:
        </p>
        <PropsTable
          columns={["Type", "PostgreSQL", "Notes"]}
          rows={[
            [<C>string</C>, "TEXT", "General-purpose text. Use for names, codes, short values."],
            [<C>text</C>, "TEXT", "Same as string in storage. Semantically indicates longer content (descriptions, comments)."],
            [<C>int</C>, "INTEGER", "32-bit signed integer. Range: -2,147,483,648 to 2,147,483,647."],
            [<C>bigint</C>, "BIGINT", "64-bit signed integer. Use for large counters or external IDs."],
            [<C>decimal</C>, "NUMERIC(18,N)", <>Fixed-point decimal. Precision set via the <C>precision</C> field property (default 2). Use for money and quantities.</>],
            [<C>boolean</C>, "BOOLEAN", <>True/false. Stored as PostgreSQL native boolean.</>],
            [<C>uuid</C>, "UUID", "Standard UUID type. Commonly used for foreign key references."],
            [<C>timestamp</C>, "TIMESTAMPTZ", <>Timestamp with time zone. Pairs well with <C>auto: "create"</C> or <C>auto: "update"</C>.</>],
            [<C>date</C>, "DATE", "Date only (no time component). Use for birthdays, due dates, etc."],
            [<C>json</C>, "JSONB", "Arbitrary JSON data. Stored as binary JSON for efficient querying."],
            [<C>file</C>, "JSONB", <>Stores file metadata as <C>{`{id, filename, size, mime_type}`}</C>. Upload via the file upload endpoint, then reference by UUID in writes.</>],
          ]}
        />
      </Section>

      <Section title="Field Properties" id="field-properties">
        <p>
          Each field in the <C>fields</C> array can have the following properties beyond{" "}
          <C>name</C> and <C>type</C>:
        </p>
        <PropsTable
          columns={["Property", "Type", "Description"]}
          rows={[
            [<C>required</C>, "boolean", <>When <C>true</C>, the field must be present and non-null on create. Validated before database insert.</>],
            [<C>unique</C>, "boolean", <>When <C>true</C>, adds a UNIQUE constraint on the column. Duplicate values return a <C>CONFLICT</C> error.</>],
            [<C>default</C>, "any", <>Default value inserted when the field is not provided. Can be a string, number, boolean, or null.</>],
            [<C>nullable</C>, "boolean", <>When <C>true</C>, the column allows NULL values. Defaults to <C>true</C> unless <C>required</C> is set.</>],
            [<C>enum</C>, "string[]", <>Restricts the field to a fixed set of allowed values. Validated on create and update. Example: <C>["low", "medium", "high"]</C>.</>],
            [<C>precision</C>, "number", <>Decimal places for <C>decimal</C> fields. Maps to <C>NUMERIC(18, precision)</C>. Default is 2.</>],
            [<C>auto</C>, <><C>"create"</C> | <C>"update"</C></>, <>Automatically sets the field to the current timestamp. <C>"create"</C> sets the value only on INSERT. <C>"update"</C> sets the value on both INSERT and UPDATE.</>],
          ]}
        />
        <InfoBox type="note" title="auto field behavior">
          <p>
            Fields with <C>auto: "create"</C> are set once when the record is first created (ideal
            for <C>created_at</C>). Fields with <C>auto: "update"</C> are set on every write,
            including the initial create (ideal for <C>updated_at</C>). Auto fields are
            automatically excluded from user input validation — you don't need to send them in your
            request body.
          </p>
        </InfoBox>
      </Section>

      <Section title="Soft Delete" id="soft-delete">
        <p>
          When soft delete is enabled on an entity, <C>DELETE</C> requests do not remove the row
          from the database. Instead, a <C>deleted_at</C> timestamp is set on the record. All
          queries automatically exclude soft-deleted records — they remain in the database but are
          invisible to the API.
        </p>
        <CodeBlock language="json" title="Enabling soft delete">
{`{
  "soft_delete": {
    "enabled": true,
    "field": "deleted_at"
  }
}`}
        </CodeBlock>
        <p>
          The <C>field</C> property names the column that stores the deletion timestamp. The
          migrator automatically adds this column (type <C>TIMESTAMPTZ</C>) to the table.
        </p>
        <InfoBox type="warning" title="Cascade policies">
          <p>
            When you soft-delete a record that has related records via a one-to-many relation, the
            cascade policy on the relation determines what happens to the children. Make sure to
            configure cascade policies on your relations to match your data integrity requirements.
          </p>
        </InfoBox>
        <InfoBox type="tip">
          <p>
            If soft delete is not enabled, <C>DELETE</C> performs a hard delete — the row is
            permanently removed from the database. There is no built-in undo for hard deletes.
          </p>
        </InfoBox>
      </Section>

      <Section title="Auto-Migration" id="auto-migration">
        <p>
          The engine includes an <strong>auto-migrator</strong> that keeps your PostgreSQL schema in
          sync with your entity definitions. You never write DDL manually.
        </p>
        <PropsTable
          columns={["Action", "What Happens"]}
          rows={[
            ["Create entity", <>A new table is created with all defined columns, primary key, unique constraints, and the soft delete column (if enabled).</>],
            ["Add a field", <>An <C>ALTER TABLE ADD COLUMN</C> statement adds the new column to the existing table.</>],
            ["Remove a field", <>The column is <strong>not</strong> dropped. The field is hidden from the API (queries, writes, responses) but the data is preserved in the database.</>],
            ["Change field type", "Not supported via auto-migration. Create a new field and migrate data manually if needed."],
          ]}
        />
        <InfoBox type="important" title="Columns are never dropped">
          <p>
            This is a deliberate safety decision. Removing a field from the entity definition hides
            it from the API, but the underlying column and its data remain in PostgreSQL. This
            prevents accidental data loss from metadata changes.
          </p>
        </InfoBox>
      </Section>

      <Section title="Example: Product Catalog Entity" id="example-product">
        <p>
          Here is a comprehensive entity definition for a product catalog, demonstrating many field
          types and properties:
        </p>
        <CodeBlock language="json" title="Product catalog entity">
{`{
  "name": "product",
  "primary_key": {
    "field": "id",
    "type": "uuid",
    "generated": true
  },
  "soft_delete": {
    "enabled": true,
    "field": "deleted_at"
  },
  "fields": [
    {
      "name": "sku",
      "type": "string",
      "required": true,
      "unique": true
    },
    {
      "name": "name",
      "type": "string",
      "required": true
    },
    {
      "name": "description",
      "type": "text"
    },
    {
      "name": "category",
      "type": "string",
      "enum": ["electronics", "clothing", "food", "furniture", "other"],
      "required": true
    },
    {
      "name": "price",
      "type": "decimal",
      "precision": 2,
      "required": true
    },
    {
      "name": "cost",
      "type": "decimal",
      "precision": 4
    },
    {
      "name": "stock_quantity",
      "type": "int",
      "default": 0
    },
    {
      "name": "is_active",
      "type": "boolean",
      "default": true
    },
    {
      "name": "supplier_id",
      "type": "uuid"
    },
    {
      "name": "release_date",
      "type": "date"
    },
    {
      "name": "image",
      "type": "file"
    },
    {
      "name": "attributes",
      "type": "json"
    },
    {
      "name": "created_at",
      "type": "timestamp",
      "auto": "create"
    },
    {
      "name": "updated_at",
      "type": "timestamp",
      "auto": "update"
    }
  ]
}`}
        </CodeBlock>
        <p>This entity definition demonstrates:</p>
        <ul class="help-list">
          <li><C>sku</C> — a required, unique string identifier for each product</li>
          <li><C>category</C> — an enum field restricting values to a fixed set</li>
          <li><C>price</C> and <C>cost</C> — decimal fields with different precision (2 and 4 decimal places)</li>
          <li><C>stock_quantity</C> — an integer with a default value of 0</li>
          <li><C>is_active</C> — a boolean flag defaulting to true</li>
          <li><C>supplier_id</C> — a UUID field for referencing another entity (would pair with a relation)</li>
          <li><C>release_date</C> — a date field with no time component</li>
          <li><C>image</C> — a file field for product images (upload via the file endpoint, reference by UUID)</li>
          <li><C>attributes</C> — a JSON field for arbitrary structured data (color, weight, dimensions, etc.)</li>
          <li><C>created_at</C> / <C>updated_at</C> — auto-managed timestamp fields</li>
        </ul>
        <InfoBox type="tip" title="Creating via the API">
          <p>
            You can also create this entity via the Admin API by POSTing the JSON above to{" "}
            <C>POST /api/:app/_admin/entities</C>. The auto-migrator will create the table
            immediately.
          </p>
        </InfoBox>
      </Section>
    </div>
  );
}
