import { Section, CodeBlock, InfoBox, PropsTable, EndpointBlock, C } from "./help-components";

export default function Workflows() {
  return (
    <div>
      <Section title="Overview" id="overview">
        <p>
          Workflows are <strong>multi-step, long-running processes</strong> triggered by state
          changes in your entities. They support approval gates, conditional branching, automatic
          actions, and timed escalation. Workflows are <strong>Layer 4</strong> in the 4-layer
          business logic architecture.
        </p>
        <p>
          Unlike state machines, which govern a single field transition, workflows span{" "}
          <strong>multiple steps across time</strong>. A workflow can pause and wait for human
          approval, branch based on data conditions, execute automatic actions, and escalate
          when deadlines are missed.
        </p>
        <PropsTable
          columns={["Layer", "Name", "Scope"]}
          rows={[
            ["1", "Validation Rules", "Single field / single write"],
            ["2", "Computed / Side-Effect Rules", "Single write"],
            ["3", "State Machines", "Single field transition"],
            ["4 (this)", "Workflows", "Multiple steps across time"],
          ]}
        />
      </Section>

      <Section title="Workflow Definition" id="definition">
        <p>
          A workflow defines a trigger, context mapping, and a set of named steps. Here is a
          complete purchase order approval workflow:
        </p>
        <CodeBlock language="json" title="Purchase order approval workflow">
{`{
  "name": "purchase_order_approval",
  "trigger": {
    "type": "state_change",
    "entity": "purchase_order",
    "field": "status",
    "to": "pending_approval"
  },
  "context": {
    "record_id": "trigger.record_id",
    "amount": "trigger.record.amount",
    "department": "trigger.record.department",
    "requester": "trigger.record.created_by"
  },
  "steps": {
    "manager_approval": {
      "type": "approval",
      "assignee": { "type": "role", "value": "manager" },
      "timeout": "72h",
      "on_approve": "check_amount",
      "on_reject": "rejected",
      "on_timeout": "rejected"
    },
    "check_amount": {
      "type": "condition",
      "expression": "context.amount > 10000",
      "on_true": "finance_approval",
      "on_false": "approved"
    },
    "finance_approval": {
      "type": "approval",
      "assignee": { "type": "role", "value": "finance" },
      "timeout": "48h",
      "on_approve": "approved",
      "on_reject": "rejected",
      "on_timeout": "manager_approval"
    },
    "approved": {
      "type": "action",
      "actions": [
        {
          "type": "set_field",
          "entity": "purchase_order",
          "record_id": "context.record_id",
          "field": "status",
          "value": "approved"
        },
        {
          "type": "webhook",
          "url": "https://procurement.example.com/po-approved",
          "method": "POST"
        }
      ],
      "then": null
    },
    "rejected": {
      "type": "action",
      "actions": [
        {
          "type": "set_field",
          "entity": "purchase_order",
          "record_id": "context.record_id",
          "field": "status",
          "value": "rejected"
        }
      ],
      "then": null
    }
  },
  "active": true
}`}
        </CodeBlock>
        <InfoBox type="note">
          <p>
            When <C>then</C> is <C>null</C> in an action step, the workflow completes after
            executing the actions. This marks the instance status as <C>completed</C>.
          </p>
        </InfoBox>
      </Section>

      <Section title="Trigger Configuration" id="trigger">
        <p>
          Workflows are started automatically when a trigger condition is met. Currently, the
          only supported trigger type is <C>state_change</C>.
        </p>
        <PropsTable
          columns={["Property", "Type", "Description"]}
          rows={[
            [<C>type</C>, <C>"state_change"</C>, "The trigger type. Currently only state_change is supported."],
            [<C>entity</C>, "string", "The entity to watch for state changes."],
            [<C>field</C>, "string", "The field on the entity that is managed by a state machine."],
            [<C>to</C>, "string", "The target state value. When the field changes to this value, the workflow is triggered."],
          ]}
        />
        <p>
          When the specified entity's field changes to the target value, the engine creates a
          new workflow instance and begins executing from the first step defined in the{" "}
          <C>steps</C> map.
        </p>
        <InfoBox type="important">
          <p>
            The trigger entity must have a state machine defined on the specified field. The
            workflow fires after the state machine transition completes successfully.
          </p>
        </InfoBox>
      </Section>

      <Section title="Context" id="context">
        <p>
          The <C>context</C> block maps values from the trigger event into workflow variables.
          These variables are available to all steps throughout the workflow's lifetime as{" "}
          <C>context.key</C>.
        </p>
        <CodeBlock language="json" title="Context mapping example">
{`{
  "context": {
    "record_id": "trigger.record_id",
    "amount": "trigger.record.amount",
    "department": "trigger.record.department",
    "requester": "trigger.record.created_by",
    "requester_email": "trigger.record.email"
  }
}`}
        </CodeBlock>
        <p>
          The <C>trigger</C> object provides access to the event that started the workflow:
        </p>
        <PropsTable
          columns={["Path", "Description"]}
          rows={[
            [<C>trigger.record_id</C>, "The ID of the record that triggered the workflow"],
            [<C>trigger.record.*</C>, "Any field on the triggering record (e.g., trigger.record.amount)"],
            [<C>trigger.entity</C>, "The name of the entity that triggered the workflow"],
            [<C>trigger.field</C>, "The state field that changed"],
            [<C>trigger.from</C>, "The previous state value"],
            [<C>trigger.to</C>, "The new state value"],
          ]}
        />
        <InfoBox type="tip">
          <p>
            Context values are captured at trigger time and remain fixed for the lifetime of the
            workflow instance. If the source record changes after the workflow starts, the
            context still holds the original values.
          </p>
        </InfoBox>
      </Section>

      <Section title="Step Types" id="step-types">
        <p>
          Workflows support three step types, each serving a different purpose in the process
          flow.
        </p>

        <h3>Action Step</h3>
        <p>
          Action steps execute operations immediately and then move to the next step. They are
          used for automatic side effects like updating records, firing webhooks, or emitting
          events.
        </p>
        <CodeBlock language="json" title="Action step example">
{`{
  "approved": {
    "type": "action",
    "actions": [
      {
        "type": "set_field",
        "entity": "purchase_order",
        "record_id": "context.record_id",
        "field": "status",
        "value": "approved"
      },
      {
        "type": "send_event",
        "event": "po_approved",
        "payload": {
          "record_id": "context.record_id",
          "amount": "context.amount"
        }
      }
    ],
    "then": "notify_requester"
  }
}`}
        </CodeBlock>
        <p>
          The <C>then</C> property specifies the next step to execute. Set it to{" "}
          <C>null</C> to end the workflow after the actions complete.
        </p>

        <h3>Condition Step</h3>
        <p>
          Condition steps evaluate an expression and branch to different steps based on the
          result. The expression is evaluated against the workflow context.
        </p>
        <CodeBlock language="json" title="Condition step example">
{`{
  "check_amount": {
    "type": "condition",
    "expression": "context.amount > 10000",
    "on_true": "finance_approval",
    "on_false": "approved"
  }
}`}
        </CodeBlock>
        <p>
          If the expression evaluates to <C>true</C>, the workflow proceeds to the{" "}
          <C>on_true</C> step. Otherwise, it proceeds to <C>on_false</C>. The expression has
          access to the full <C>context</C> object.
        </p>

        <h3>Approval Step</h3>
        <p>
          Approval steps pause the workflow and wait for a human to approve or reject. The
          workflow instance enters a <C>running</C> state with a pending approval that appears
          in the pending approvals list.
        </p>
        <CodeBlock language="json" title="Approval step example">
{`{
  "manager_approval": {
    "type": "approval",
    "assignee": { "type": "role", "value": "manager" },
    "timeout": "72h",
    "on_approve": "check_amount",
    "on_reject": "rejected",
    "on_timeout": "rejected"
  }
}`}
        </CodeBlock>
        <p>
          The approval step stays active until someone with the appropriate role approves or
          rejects, or until the timeout expires.
        </p>
      </Section>

      <Section title="Assignee Types" id="assignee-types">
        <p>
          The <C>assignee</C> field on approval steps determines who can approve or reject the
          step.
        </p>
        <PropsTable
          columns={["Type", "Value", "Description"]}
          rows={[
            [<C>role</C>, "Role name (string)", "Any user with this role can approve or reject. E.g., any user with the \"manager\" role."],
            [<C>relation</C>, "Relation path (string)", "Follow a relation path from the trigger record to find the assignee. E.g., \"department.manager\" resolves the manager via the record's department."],
            [<C>fixed</C>, "User ID (UUID string)", "A specific user identified by their UUID. Use for known approvers like a CFO or compliance officer."],
          ]}
        />
        <InfoBox type="tip">
          <p>
            The <C>role</C> assignee type is the most flexible and commonly used. It allows any
            user with the matching role to handle the approval, which avoids bottlenecks when a
            specific person is unavailable.
          </p>
        </InfoBox>
      </Section>

      <Section title="Timeouts and Escalation" id="timeouts">
        <p>
          Approval steps can include a <C>timeout</C> value that specifies how long to wait
          before automatically following the <C>on_timeout</C> path. Timeouts are expressed as
          duration strings.
        </p>
        <PropsTable
          columns={["Format", "Example", "Description"]}
          rows={[
            ["Hours", <C>"72h"</C>, "72 hours from when the step becomes active"],
            ["Hours", <C>"48h"</C>, "48 hours"],
            ["Hours", <C>"24h"</C>, "24 hours"],
            ["Minutes", <C>"30m"</C>, "30 minutes (useful for testing)"],
          ]}
        />
        <p>
          A background scheduler checks for expired approval deadlines every <strong>60
          seconds</strong>. When a deadline is reached, the scheduler automatically transitions
          the workflow to the <C>on_timeout</C> step.
        </p>
        <InfoBox type="note" title="Escalation pattern">
          <p>
            You can implement escalation by pointing <C>on_timeout</C> back to a previous step
            or to a different approval step with a higher-level role. For example, if a manager
            does not respond within 72 hours, the <C>on_timeout</C> can route to a director
            approval step or loop back to the same step for a retry.
          </p>
        </InfoBox>
        <CodeBlock language="json" title="Escalation via timeout loop">
{`{
  "finance_approval": {
    "type": "approval",
    "assignee": { "type": "role", "value": "finance" },
    "timeout": "48h",
    "on_approve": "approved",
    "on_reject": "rejected",
    "on_timeout": "manager_approval"
  }
}`}
        </CodeBlock>
        <p>
          In this example, if the finance team does not respond within 48 hours, the workflow
          loops back to the <C>manager_approval</C> step for re-evaluation.
        </p>
      </Section>

      <Section title="Runtime Endpoints" id="runtime-endpoints">
        <p>
          Workflow instances are managed through dedicated runtime endpoints. These are separate
          from the admin CRUD endpoints used to define workflows.
        </p>
        <EndpointBlock
          method="GET"
          url="/api/:app/_workflows/pending"
          description="List all workflow instances awaiting approval"
        />
        <EndpointBlock
          method="GET"
          url="/api/:app/_workflows/:id"
          description="Get details of a specific workflow instance"
        />
        <EndpointBlock
          method="POST"
          url="/api/:app/_workflows/:id/approve"
          description="Approve the current pending step"
        />
        <EndpointBlock
          method="POST"
          url="/api/:app/_workflows/:id/reject"
          description="Reject the current pending step"
        />
        <p>Here is an example response from the instance detail endpoint:</p>
        <CodeBlock language="json" title="Workflow instance response">
{`{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "workflow_id": "f0e1d2c3-b4a5-6789-0abc-def123456789",
  "workflow_name": "purchase_order_approval",
  "status": "running",
  "current_step": "finance_approval",
  "current_step_deadline": "2025-03-15T14:30:00Z",
  "context": {
    "record_id": "11223344-5566-7788-99aa-bbccddeeff00",
    "amount": 25000,
    "department": "engineering",
    "requester": "44556677-8899-aabb-ccdd-eeff00112233"
  },
  "history": [
    {
      "step": "manager_approval",
      "action": "approved",
      "by": "99887766-5544-3322-1100-ffeeddccbbaa",
      "at": "2025-03-13T10:15:00Z"
    },
    {
      "step": "check_amount",
      "result": true,
      "at": "2025-03-13T10:15:01Z"
    }
  ],
  "created_at": "2025-03-12T09:00:00Z",
  "updated_at": "2025-03-13T10:15:01Z"
}`}
        </CodeBlock>
        <InfoBox type="note">
          <p>
            The <C>history</C> array records every step the workflow has passed through,
            including who acted and when. This provides a complete audit trail for the process.
          </p>
        </InfoBox>
      </Section>

      <Section title="Workflow Instance Lifecycle" id="lifecycle">
        <p>
          Every workflow instance has a <C>status</C> field that tracks its overall state:
        </p>
        <PropsTable
          columns={["Status", "Description"]}
          rows={[
            [<C>running</C>, "The workflow is active. It may be executing an action step, evaluating a condition, or waiting for an approval."],
            [<C>completed</C>, "The workflow reached a terminal action step (one where \"then\" is null). All actions executed successfully."],
            [<C>failed</C>, "An error occurred during step execution (e.g., a webhook action returned an error, or a set_field targeted a nonexistent record)."],
            [<C>cancelled</C>, "The workflow was manually cancelled via the admin API or programmatically through an action."],
          ]}
        />
        <InfoBox type="warning">
          <p>
            Once a workflow instance reaches <C>completed</C>, <C>failed</C>, or{" "}
            <C>cancelled</C> status, it cannot be restarted. If the process needs to run again,
            a new instance must be triggered by another state change.
          </p>
        </InfoBox>
      </Section>

      <Section title="Example: Employee Onboarding" id="example-onboarding">
        <p>
          Here is a complete onboarding workflow that combines all three step types: automatic
          account creation, an HR approval gate, conditional branching by department, and a
          final setup step.
        </p>
        <CodeBlock language="json" title="Employee onboarding workflow">
{`{
  "name": "employee_onboarding",
  "trigger": {
    "type": "state_change",
    "entity": "employee",
    "field": "status",
    "to": "onboarding"
  },
  "context": {
    "record_id": "trigger.record_id",
    "employee_name": "trigger.record.full_name",
    "email": "trigger.record.email",
    "department": "trigger.record.department",
    "start_date": "trigger.record.start_date"
  },
  "steps": {
    "create_accounts": {
      "type": "action",
      "actions": [
        {
          "type": "webhook",
          "url": "https://it.example.com/provision-accounts",
          "method": "POST"
        },
        {
          "type": "set_field",
          "entity": "employee",
          "record_id": "context.record_id",
          "field": "accounts_provisioned",
          "value": true
        }
      ],
      "then": "hr_checklist"
    },
    "hr_checklist": {
      "type": "approval",
      "assignee": { "type": "role", "value": "hr" },
      "timeout": "72h",
      "on_approve": "check_department",
      "on_reject": "hr_checklist",
      "on_timeout": "hr_checklist"
    },
    "check_department": {
      "type": "condition",
      "expression": "context.department == 'engineering'",
      "on_true": "setup_dev_env",
      "on_false": "complete"
    },
    "setup_dev_env": {
      "type": "action",
      "actions": [
        {
          "type": "webhook",
          "url": "https://it.example.com/setup-dev-environment",
          "method": "POST"
        },
        {
          "type": "set_field",
          "entity": "employee",
          "record_id": "context.record_id",
          "field": "dev_env_ready",
          "value": true
        }
      ],
      "then": "complete"
    },
    "complete": {
      "type": "action",
      "actions": [
        {
          "type": "set_field",
          "entity": "employee",
          "record_id": "context.record_id",
          "field": "status",
          "value": "active"
        },
        {
          "type": "send_event",
          "event": "onboarding_complete",
          "payload": {
            "employee_id": "context.record_id",
            "name": "context.employee_name"
          }
        }
      ],
      "then": null
    }
  },
  "active": true
}`}
        </CodeBlock>
        <InfoBox type="tip" title="Self-healing approval">
          <p>
            Notice that the <C>hr_checklist</C> step points both <C>on_reject</C> and{" "}
            <C>on_timeout</C> back to itself. This creates a retry loop: if HR rejects or does
            not respond in time, the step simply reactivates and waits again. This pattern is
            useful for mandatory steps that must eventually be completed.
          </p>
        </InfoBox>
      </Section>
    </div>
  );
}
