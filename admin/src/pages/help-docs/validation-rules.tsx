import { Section, CodeBlock, InfoBox, PropsTable, C } from "./help-components";

export default function ValidationRules() {
  return (
    <div>
      <Section title="Overview" id="overview">
        <p>
          Rules are the <strong>validation and transformation layer</strong> of Rocket Backend. They
          let you enforce business constraints and compute derived values without writing backend code
          — everything is defined as metadata and evaluated at runtime.
        </p>
        <p>
          Rocket uses a <strong>four-layer architecture</strong> for business logic:
        </p>
        <ol class="help-list">
          <li><strong>Field rules</strong> — simple per-field checks (fast, no database lookups).</li>
          <li><strong>Expression rules</strong> — cross-field, conditional, and cross-entity logic using expressions.</li>
          <li><strong>State machines</strong> — transition guards and actions on state fields (see the State Machines page).</li>
          <li><strong>Workflows</strong> — multi-step, long-running processes (see the Workflows page).</li>
        </ol>
        <p>
          This page covers layers 1 and 2 plus <strong>computed fields</strong>. Each layer is
          optional — a simple CRUD entity might only use field rules, while a complex financial
          entity might use all four layers.
        </p>
      </Section>

      <Section title="Rule Types" id="rule-types">
        <p>
          There are three rule types, distinguished by the <C>type</C> field in the rule definition:
        </p>
        <PropsTable
          columns={["Type", "Purpose", "Complexity"]}
          rows={[
            [<C>field</C>, "Simple per-field validation using operators (eq, gte, in, etc.).", "Low — no database lookups needed."],
            [<C>expression</C>, "Cross-field and conditional logic using expr-lang expressions.", "Medium — may require related data loading."],
            [<C>computed</C>, "Auto-calculated field values using expressions.", "Medium — sets values rather than validating."],
          ]}
        />
      </Section>

      <Section title="Field Rules" id="field-rules">
        <p>
          Field rules perform simple per-field validation using operators. They are fast because they
          require no database lookups — they only inspect the incoming payload.
        </p>
        <CodeBlock language="json" title="Field rule: invoice total must be non-negative">
{`{
  "entity": "invoice",
  "hook": "before_write",
  "type": "field",
  "definition": {
    "conditions": [
      { "field": "total", "operator": "gte", "value": 0 },
      { "field": "number", "operator": "neq", "value": "" }
    ],
    "message": "Invoice total must be non-negative and number is required"
  },
  "priority": 10,
  "active": true
}`}
        </CodeBlock>

        <h3>Available Operators</h3>
        <PropsTable
          columns={["Operator", "Description", "Example"]}
          rows={[
            [<C>eq</C>, "Equal to", <><C>{"{ \"field\": \"status\", \"operator\": \"eq\", \"value\": \"active\" }"}</C></>],
            [<C>neq</C>, "Not equal to", <><C>{"{ \"field\": \"status\", \"operator\": \"neq\", \"value\": \"\" }"}</C></>],
            [<C>gt</C>, "Greater than", <><C>{"{ \"field\": \"quantity\", \"operator\": \"gt\", \"value\": 0 }"}</C></>],
            [<C>gte</C>, "Greater than or equal to", <><C>{"{ \"field\": \"total\", \"operator\": \"gte\", \"value\": 0 }"}</C></>],
            [<C>lt</C>, "Less than", <><C>{"{ \"field\": \"discount\", \"operator\": \"lt\", \"value\": 100 }"}</C></>],
            [<C>lte</C>, "Less than or equal to", <><C>{"{ \"field\": \"priority\", \"operator\": \"lte\", \"value\": 10 }"}</C></>],
            [<C>in</C>, "Value is in list", <><C>{"{ \"field\": \"status\", \"operator\": \"in\", \"value\": [\"draft\", \"sent\"] }"}</C></>],
            [<C>not_in</C>, "Value is not in list", <><C>{"{ \"field\": \"type\", \"operator\": \"not_in\", \"value\": [\"archived\", \"deleted\"] }"}</C></>],
            [<C>like</C>, "String pattern match", <><C>{"{ \"field\": \"email\", \"operator\": \"like\", \"value\": \"%@company.com\" }"}</C></>],
          ]}
        />

        <InfoBox type="important" title="True means violated">
          <p>
            Field rule expressions return <C>true</C> when the rule is <strong>violated</strong>.
            In other words: <C>true</C> = fail, <C>false</C> = pass. If a condition evaluates to
            true, the error message is returned to the client.
          </p>
        </InfoBox>
      </Section>

      <Section title="Expression Rules" id="expression-rules">
        <p>
          Expression rules use <strong>expr-lang</strong> expressions for complex validation logic.
          They can reference multiple fields, compare against the previous state of the record,
          check related entities, and inspect the current user's roles.
        </p>
        <CodeBlock language="json" title="Expression rule: payment date required when paid">
{`{
  "entity": "invoice",
  "hook": "before_write",
  "type": "expression",
  "definition": {
    "expression": "record.status == 'paid' && record.payment_date == nil",
    "message": "Payment date is required when status is paid"
  },
  "priority": 20,
  "active": true
}`}
        </CodeBlock>
        <p>
          Just like field rules, the expression returns <C>true</C> when the rule is <strong>violated
          </strong>. If the expression evaluates to true, the error message is sent back to the client.
        </p>

        <h3>Expression Environment</h3>
        <p>
          Every expression has access to the following variables:
        </p>
        <PropsTable
          columns={["Variable", "Type", "Description"]}
          rows={[
            [<C>record</C>, "map", "The incoming payload — the data being written."],
            [<C>old</C>, "map / nil", <>The current database state of the record. Available on updates; <C>nil</C> for creates.</>],
            [<C>related</C>, "map", <>Pre-loaded related data (requires <C>related_load</C> configuration).</>],
            [<C>user</C>, "object", <><C>{`{ id, roles }`}</C> — the authenticated user making the request.</>],
            [<C>action</C>, "string", <><C>"create"</C>, <C>"update"</C>, or <C>"delete"</C> — the current operation.</>],
            [<C>now</C>, "timestamp", "The current server timestamp."],
          ]}
        />
      </Section>

      <Section title="Expression Examples" id="expression-examples">
        <h3>Conditional Required Field</h3>
        <p>Require <C>payment_date</C> only when the invoice status is <C>paid</C>:</p>
        <CodeBlock language="json" title="Conditional required: payment_date when status is paid">
{`{
  "entity": "invoice",
  "hook": "before_write",
  "type": "expression",
  "definition": {
    "expression": "record.status == 'paid' && record.payment_date == nil",
    "message": "Payment date is required when status is paid"
  },
  "priority": 20,
  "active": true
}`}
        </CodeBlock>

        <h3>Cross-Field Comparison</h3>
        <p>Ensure <C>end_date</C> is after <C>start_date</C>:</p>
        <CodeBlock language="json" title="Cross-field: end_date must be after start_date">
{`{
  "entity": "project",
  "hook": "before_write",
  "type": "expression",
  "definition": {
    "expression": "record.end_date != nil && record.end_date <= record.start_date",
    "message": "End date must be after start date"
  },
  "priority": 20,
  "active": true
}`}
        </CodeBlock>

        <h3>Prevent Update of Locked Records</h3>
        <p>Block any modifications to voided invoices:</p>
        <CodeBlock language="json" title="Prevent updates to voided invoices">
{`{
  "entity": "invoice",
  "hook": "before_write",
  "type": "expression",
  "definition": {
    "expression": "action == 'update' && old != nil && old.status == 'void'",
    "message": "Voided invoices cannot be modified"
  },
  "priority": 5,
  "active": true
}`}
        </CodeBlock>

        <h3>Cross-Entity Check</h3>
        <p>
          Prevent deleting a customer who has existing invoices. This uses <C>related_load</C> to
          pre-fetch the customer's invoices before the expression runs:
        </p>
        <CodeBlock language="json" title="Cross-entity: cannot delete customer with invoices">
{`{
  "entity": "customer",
  "hook": "before_delete",
  "type": "expression",
  "definition": {
    "expression": "len(related.invoices) > 0",
    "message": "Cannot delete customer with existing invoices",
    "related_load": [
      {
        "relation": "invoices",
        "filter": { "status.in": ["draft", "sent", "paid"] }
      }
    ]
  },
  "priority": 10,
  "active": true
}`}
        </CodeBlock>

        <h3>Role-Based Restriction</h3>
        <p>Only allow admins to change the invoice status:</p>
        <CodeBlock language="json" title="Role restriction: only admins can change status">
{`{
  "entity": "invoice",
  "hook": "before_write",
  "type": "expression",
  "definition": {
    "expression": "action == 'update' && old != nil && old.status != record.status && !('admin' in user.roles)",
    "message": "Only admins can change invoice status"
  },
  "priority": 15,
  "active": true
}`}
        </CodeBlock>
      </Section>

      <Section title="Related Data Loading" id="related-data-loading">
        <p>
          Some expression rules need to inspect related entities — for example, checking whether a
          customer has open invoices before allowing deletion. The <C>related_load</C> field tells
          the engine which relations to <strong>pre-fetch from the database</strong> before evaluating
          the expression.
        </p>
        <CodeBlock language="json" title="related_load with a filter">
{`"related_load": [
  {
    "relation": "invoices",
    "filter": { "status.in": ["draft", "sent", "paid"] }
  }
]`}
        </CodeBlock>
        <p>
          The loaded data becomes available on the <C>related</C> object in the expression
          environment. For a one-to-many relation, <C>related.invoices</C> is an array of records.
          For a one-to-one relation, it is a single record or nil.
        </p>
        <InfoBox type="tip" title="Keep related_load focused">
          <p>
            Use filters in <C>related_load</C> to fetch only the data you need. Loading all related
            records without a filter works but may be slower for entities with many children. The
            filter syntax is the same as the REST API query filters.
          </p>
        </InfoBox>
      </Section>

      <Section title="Computed Fields" id="computed-fields">
        <p>
          Computed rules <strong>set field values automatically</strong> rather than validating them.
          They use the same expression language but write the result back to the record before the
          SQL statement executes.
        </p>
        <CodeBlock language="json" title="Computed field: line_total = quantity * unit_price">
{`{
  "entity": "invoice_item",
  "hook": "before_write",
  "type": "computed",
  "definition": {
    "field": "line_total",
    "expression": "record.quantity * record.unit_price"
  },
  "priority": 50,
  "active": true
}`}
        </CodeBlock>
        <p>
          With this rule, whenever an invoice item is created or updated, the <C>line_total</C> field
          is automatically calculated from <C>quantity</C> and <C>unit_price</C>. The client does not
          need to send <C>line_total</C> in the payload — it is computed server-side.
        </p>
        <InfoBox type="note">
          <p>
            Computed fields run <strong>after</strong> validation rules but <strong>before</strong> the
            SQL INSERT or UPDATE. This means validation rules see the original payload values, while
            the database receives the computed values.
          </p>
        </InfoBox>
      </Section>

      <Section title="Execution Order" id="execution-order">
        <p>
          Within a <C>before_write</C> hook, the four layers execute in a fixed order:
        </p>
        <CodeBlock language="text" title="Rule execution order within before_write">
{`1. Field rules (Layer 1)
   Fast, no database lookups.
   Check per-field constraints: required, range, enum, pattern.

       |
       v

2. Expression rules (Layer 2)
   May require related_load (database queries).
   Cross-field checks, conditional logic, role restrictions.

       |
       v

3. Computed fields
   Set derived values on the record.
   Runs after validation, before SQL execution.

       |
       v

4. State machine guards (Layer 3)
   If the entity has a state machine and the state field changed,
   validate the transition, check roles, evaluate guard expressions.`}
        </CodeBlock>
        <p>
          If any rule fails with <C>stop_on_fail: true</C>, the remaining rules in that layer (and
          subsequent layers) are skipped. If <C>stop_on_fail: false</C> (the default), all rules run
          and all errors are collected into a single response.
        </p>
      </Section>

      <Section title="Priority and stop_on_fail" id="priority-and-stop">
        <p>
          Rules within each type are executed in <strong>priority order</strong>. A lower priority
          number runs first.
        </p>
        <PropsTable
          columns={["Property", "Default", "Description"]}
          rows={[
            [<C>priority</C>, <C>0</C>, "Execution order within the same type. Lower numbers run first."],
            [<C>stop_on_fail</C>, <C>false</C>, <>When <C>true</C>, if this rule fails, all subsequent rules are skipped and the error is returned immediately.</>],
          ]}
        />
        <p>
          Use <C>stop_on_fail: true</C> for critical preconditions where running further rules would
          be meaningless — for example, a rule that checks whether a record exists before running
          cross-field validations against it.
        </p>
        <p>
          With the default <C>stop_on_fail: false</C>, all rules execute and the response includes
          every validation error at once. This is better for user-facing forms where you want to show
          all problems in a single round-trip.
        </p>
      </Section>

      <Section title="Rule Definition Reference" id="rule-reference">
        <p>
          Complete reference for all properties in a rule JSON object:
        </p>
        <PropsTable
          columns={["Property", "Type", "Required", "Description"]}
          rows={[
            [<C>entity</C>, "string", "Yes", "The entity this rule applies to."],
            [<C>hook</C>, "string", "Yes", <><C>"before_write"</C> or <C>"before_delete"</C>. When this rule is evaluated.</>],
            [<C>type</C>, "string", "Yes", <><C>"field"</C>, <C>"expression"</C>, or <C>"computed"</C>. Determines how the rule is evaluated.</>],
            [<C>definition</C>, "object", "Yes", "The rule logic. Contents vary by type (see below)."],
            [<C>priority</C>, "number", "No", "Execution order (lower runs first). Defaults to 0."],
            [<C>active</C>, "boolean", "No", <>Whether the rule is enabled. Defaults to <C>true</C>.</>],
          ]}
        />

        <h3>Definition for type: field</h3>
        <PropsTable
          columns={["Property", "Type", "Description"]}
          rows={[
            [<C>conditions</C>, "array", <>Array of <C>{`{ field, operator, value }`}</C> objects.</>],
            [<C>message</C>, "string", "Error message returned when the rule is violated."],
          ]}
        />

        <h3>Definition for type: expression</h3>
        <PropsTable
          columns={["Property", "Type", "Description"]}
          rows={[
            [<C>expression</C>, "string", "An expr-lang expression. Returns true when the rule is violated."],
            [<C>message</C>, "string", "Error message returned when the expression evaluates to true."],
            [<C>related_load</C>, "array", <>(Optional) Relations to pre-fetch before evaluating the expression. Each item has <C>relation</C> (string) and optionally <C>filter</C> (object).</>],
            [<C>stop_on_fail</C>, "boolean", <>(Optional) If true, halts rule chain on failure. Defaults to <C>false</C>.</>],
          ]}
        />

        <h3>Definition for type: computed</h3>
        <PropsTable
          columns={["Property", "Type", "Description"]}
          rows={[
            [<C>field</C>, "string", "The field name to set the computed value on."],
            [<C>expression</C>, "string", "An expr-lang expression whose result is written to the field."],
            [<C>related_load</C>, "array", "(Optional) Relations to pre-fetch before evaluating the expression."],
          ]}
        />
      </Section>
    </div>
  );
}
