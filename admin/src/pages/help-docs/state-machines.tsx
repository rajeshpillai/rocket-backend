import { Section, CodeBlock, InfoBox, PropsTable, C, EndpointBlock } from "./help-components";

export default function StateMachines() {
  return (
    <div>
      <Section title="Overview" id="overview">
        <p>
          State machines control <strong>allowed transitions</strong> on a state or status field.
          You define valid paths through a set of states, specifying which roles can trigger each
          transition, guard expressions that must evaluate to true, and automatic actions that fire
          on transition.
        </p>
        <p>
          State machines are <strong>Layer 3</strong> in the 4-layer business logic architecture:
        </p>
        <PropsTable
          columns={["Layer", "Name", "Purpose"]}
          rows={[
            ["1", "Validation Rules", "Field-level and cross-field validation"],
            ["2", "Computed / Side-Effect Rules", "Auto-set fields, enforce invariants"],
            ["3 (this)", "State Machines", "Guard state transitions, enforce lifecycle"],
            ["4", "Workflows", "Multi-step, long-running processes"],
          ]}
        />
        <p>
          When a write request changes a state-managed field, the engine intercepts the change,
          finds the matching transition, checks roles and guards, executes actions, and then
          proceeds with the normal write pipeline. If no valid transition exists, the write is
          rejected.
        </p>
      </Section>

      <Section title="State Machine Definition" id="definition">
        <p>
          A state machine is attached to an entity and governs a single field. Here is a complete
          example for an invoice lifecycle:
        </p>
        <CodeBlock language="json" title="Invoice lifecycle state machine">
{`{
  "entity": "invoice",
  "field": "status",
  "definition": {
    "initial": "draft",
    "transitions": [
      {
        "from": "draft",
        "to": "sent",
        "roles": ["admin", "accountant"],
        "guard": null,
        "actions": [
          { "type": "set_field", "field": "sent_at", "value": "now" }
        ]
      },
      {
        "from": "sent",
        "to": "paid",
        "roles": ["admin", "accountant"],
        "guard": "record.payment_date != nil && record.payment_amount >= record.total",
        "actions": [
          { "type": "set_field", "field": "paid_at", "value": "now" },
          {
            "type": "webhook",
            "url": "https://accounting.example.com/invoice-paid",
            "method": "POST"
          }
        ]
      },
      {
        "from": ["draft", "sent"],
        "to": "void",
        "roles": ["admin"],
        "guard": null,
        "actions": [
          { "type": "set_field", "field": "voided_at", "value": "now" }
        ]
      }
    ]
  },
  "active": true
}`}
        </CodeBlock>
        <InfoBox type="note">
          <p>
            The <C>initial</C> value is used as the default when creating a new record. If the
            field is not included in the create payload, the engine sets it to the initial state
            automatically.
          </p>
        </InfoBox>
      </Section>

      <Section title="State Diagram" id="state-diagram">
        <p>
          The invoice state machine above produces the following state diagram:
        </p>
        <CodeBlock language="text" title="Invoice state diagram">
{`  ┌─────────┐    send     ┌─────────┐    pay     ┌─────────┐
  │  draft   │───────────>│  sent   │──────────>│  paid   │
  └─────────┘             └─────────┘            └─────────┘
       │                       │
       │       void            │  void
       └───────────┐  ┌───────┘
                   v  v
              ┌─────────┐
              │  void   │
              └─────────┘`}
        </CodeBlock>
        <p>
          Notice that both <C>draft</C> and <C>sent</C> can transition to <C>void</C>, but
          once an invoice is <C>paid</C> or <C>void</C>, no further transitions are possible
          (terminal states).
        </p>
      </Section>

      <Section title="Transition Properties" id="transition-properties">
        <PropsTable
          columns={["Property", "Type", "Description"]}
          rows={[
            [<C>from</C>, "string | string[]", "Source state(s). The transition matches when the current value of the field equals one of these."],
            [<C>to</C>, "string", "Target state. The value the field will change to."],
            [<C>roles</C>, "string[]", "Which roles are allowed to execute this transition. If the user does not have one of these roles, a 403 is returned."],
            [<C>guard</C>, "string | null", "An expression that must evaluate to true for the transition to proceed. Uses the same expression engine as rules. Null means no guard."],
            [<C>actions</C>, "TransitionAction[]", "An array of actions to execute when the transition fires. Executed in order before the write completes."],
          ]}
        />
      </Section>

      <Section title="Guard Expressions" id="guard-expressions">
        <p>
          Guards use the <strong>same expression engine</strong> as validation rules. A guard
          expression is evaluated in the context of the current write and must return{" "}
          <C>true</C> to allow the transition. If the guard returns <C>false</C>, the
          transition is rejected with a 422 error.
        </p>
        <p>The expression environment provides these variables:</p>
        <PropsTable
          columns={["Variable", "Description"]}
          rows={[
            [<C>record</C>, "The record as it will be after the update (merged new values)"],
            [<C>old</C>, "The record before the update (current database state)"],
            [<C>user</C>, "The authenticated user making the request (id, email, roles)"],
            [<C>action</C>, "The current action: \"create\" or \"update\""],
          ]}
        />
        <p>Example guard that ensures payment is recorded before allowing the paid transition:</p>
        <CodeBlock language="text" title="Guard expression example">
{`record.payment_date != nil && record.payment_amount >= record.total`}
        </CodeBlock>
        <InfoBox type="tip">
          <p>
            Guards can reference any field on the record, including fields set by rules in
            earlier layers. This allows you to enforce complex preconditions like "the invoice
            must have at least one line item" or "the approval count must meet the threshold."
          </p>
        </InfoBox>
      </Section>

      <Section title="Transition Actions" id="transition-actions">
        <p>
          Actions execute automatically when a transition fires. They run after the guard passes
          but as part of the same write operation.
        </p>
        <PropsTable
          columns={["Action Type", "Description"]}
          rows={[
            [<C>set_field</C>, <>Set a field to a value. Use <C>"now"</C> as the value to set a timestamp field to the current time.</>],
            [<C>webhook</C>, "Fire an HTTP POST to a URL after the transaction commits. The request body contains the record data."],
            [<C>create_record</C>, "Insert a new record in another entity. Useful for creating audit entries or notifications."],
            [<C>send_event</C>, "Emit a named event that can trigger workflows or other listeners."],
          ]}
        />
        <p>Example showing a <C>set_field</C> action with <C>"now"</C> and a <C>webhook</C> action:</p>
        <CodeBlock language="json" title="Transition actions example">
{`{
  "from": "sent",
  "to": "paid",
  "roles": ["admin", "accountant"],
  "guard": "record.payment_amount >= record.total",
  "actions": [
    {
      "type": "set_field",
      "field": "paid_at",
      "value": "now"
    },
    {
      "type": "webhook",
      "url": "https://accounting.example.com/invoice-paid",
      "method": "POST"
    }
  ]
}`}
        </CodeBlock>
        <InfoBox type="note">
          <p>
            Actions execute in the order they are defined. A <C>set_field</C> action modifies
            the record data before it is written to the database. A <C>webhook</C> action
            fires after the transaction commits (asynchronous).
          </p>
        </InfoBox>
      </Section>

      <Section title="How Transitions Execute" id="how-transitions-execute">
        <p>
          When a write request includes a change to a state-managed field, the engine follows
          this sequence:
        </p>
        <ol class="help-list">
          <li>
            <strong>Detect state field changed</strong> — The engine compares the incoming value
            of the state field against the current value (for updates) or checks against the
            initial state (for creates).
          </li>
          <li>
            <strong>Find matching transition</strong> — The engine searches for a transition
            where <C>from</C> matches the current state and <C>to</C> matches the requested
            state. If no transition is found, the write is rejected with a 422 error.
          </li>
          <li>
            <strong>Check roles</strong> — The user's roles are compared against the
            transition's <C>roles</C> array. If the user lacks a matching role, a 403 Forbidden
            error is returned.
          </li>
          <li>
            <strong>Evaluate guard</strong> — If the transition has a guard expression, it is
            evaluated. If the guard returns false, a 422 error is returned with a message
            indicating the guard condition was not met.
          </li>
          <li>
            <strong>Execute actions</strong> — Each action in the transition's <C>actions</C>{" "}
            array is executed in order. <C>set_field</C> actions modify the record data;
            <C>webhook</C> actions are queued for post-commit delivery.
          </li>
          <li>
            <strong>Proceed with normal write</strong> — The record (with any modifications from
            actions) is written to the database as part of the standard write pipeline.
          </li>
        </ol>
      </Section>

      <Section title="Multiple Source States" id="multiple-source-states">
        <p>
          The <C>from</C> field accepts either a single string or an array of strings. When an
          array is provided, the transition matches if the current state is any of the listed
          values. This is useful for transitions that can originate from multiple states, such as
          a cancellation or void action.
        </p>
        <CodeBlock language="json" title="Multiple source states example">
{`{
  "from": ["draft", "sent"],
  "to": "void",
  "roles": ["admin"],
  "guard": null,
  "actions": [
    { "type": "set_field", "field": "voided_at", "value": "now" }
  ]
}`}
        </CodeBlock>
        <p>
          This single transition definition covers both <C>draft</C> to <C>void</C> and{" "}
          <C>sent</C> to <C>void</C>. Without array support, you would need two separate
          transition entries.
        </p>
      </Section>

      <Section title="Error Responses" id="error-responses">
        <p>
          When a transition fails, the engine returns a structured error response. Here are the
          two most common failure modes:
        </p>
        <h3>Invalid Transition (no matching path)</h3>
        <CodeBlock language="json" title="Invalid transition error (422)">
{`{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Invalid state transition",
    "details": [
      {
        "field": "status",
        "rule": "state_machine",
        "message": "transition from 'paid' to 'draft' is not allowed"
      }
    ]
  }
}`}
        </CodeBlock>
        <h3>Guard Condition Failed</h3>
        <CodeBlock language="json" title="Guard failure error (422)">
{`{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "State transition guard failed",
    "details": [
      {
        "field": "status",
        "rule": "state_machine_guard",
        "message": "guard condition not met for transition from 'sent' to 'paid'"
      }
    ]
  }
}`}
        </CodeBlock>
        <InfoBox type="warning">
          <p>
            Role failures return a <C>403 Forbidden</C> error rather than a 422, because the
            issue is authorization, not validation. The response uses the <C>FORBIDDEN</C> error
            code.
          </p>
        </InfoBox>
      </Section>

      <Section title="Example: Order Processing" id="example-order-processing">
        <p>
          Here is a complete state machine for an order processing lifecycle with five states
          and a cancellation path:
        </p>
        <CodeBlock language="json" title="Order processing state machine">
{`{
  "entity": "order",
  "field": "status",
  "definition": {
    "initial": "pending",
    "transitions": [
      {
        "from": "pending",
        "to": "confirmed",
        "roles": ["admin", "sales"],
        "guard": "record.items_count > 0",
        "actions": [
          { "type": "set_field", "field": "confirmed_at", "value": "now" }
        ]
      },
      {
        "from": "confirmed",
        "to": "processing",
        "roles": ["admin", "warehouse"],
        "guard": null,
        "actions": [
          { "type": "set_field", "field": "processing_started_at", "value": "now" }
        ]
      },
      {
        "from": "processing",
        "to": "shipped",
        "roles": ["admin", "warehouse"],
        "guard": "record.tracking_number != nil",
        "actions": [
          { "type": "set_field", "field": "shipped_at", "value": "now" },
          {
            "type": "webhook",
            "url": "https://notifications.example.com/order-shipped",
            "method": "POST"
          }
        ]
      },
      {
        "from": "shipped",
        "to": "delivered",
        "roles": ["admin", "logistics"],
        "guard": null,
        "actions": [
          { "type": "set_field", "field": "delivered_at", "value": "now" },
          {
            "type": "webhook",
            "url": "https://notifications.example.com/order-delivered",
            "method": "POST"
          }
        ]
      },
      {
        "from": ["pending", "confirmed"],
        "to": "cancelled",
        "roles": ["admin", "sales", "customer"],
        "guard": null,
        "actions": [
          { "type": "set_field", "field": "cancelled_at", "value": "now" },
          {
            "type": "webhook",
            "url": "https://notifications.example.com/order-cancelled",
            "method": "POST"
          }
        ]
      }
    ]
  },
  "active": true
}`}
        </CodeBlock>
        <InfoBox type="tip" title="Terminal states">
          <p>
            States like <C>delivered</C> and <C>cancelled</C> have no outbound transitions,
            making them terminal states. Once an order reaches either state, no further status
            changes are possible through the state machine.
          </p>
        </InfoBox>
      </Section>
    </div>
  );
}
