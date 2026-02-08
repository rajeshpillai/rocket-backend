import { Section, CodeBlock, PropsTable, InfoBox, EndpointBlock, C } from "./help-components";

export default function WebhooksHelp() {
  return (
    <div>
      {/* ── Overview ── */}
      <Section title="Overview" id="overview">
        <p>
          Webhooks are <strong>HTTP callouts</strong> triggered by entity write and delete events.
          They are the escape hatch for integrating with external systems -- notifications, payment
          gateways, audit services, fraud detection, or any logic that cannot be expressed
          declaratively with rules, state machines, or workflows.
        </p>
        <p style={{ "margin-top": "0.75rem" }}>
          Webhooks are defined as metadata in the <C>_webhooks</C> table and managed via the Admin
          API or Admin UI. When an entity event matches a webhook's configuration, the engine
          dispatches an HTTP request to the configured URL with a structured JSON payload.
        </p>
        <InfoBox type="note">
          <p>
            Webhooks support two modes: <strong>async</strong> (fire-and-forget after commit) and{" "}
            <strong>sync</strong> (fire inside the transaction, can veto the write). Choose the mode
            that matches your reliability and latency requirements.
          </p>
        </InfoBox>
      </Section>

      {/* ── Webhook Definition ── */}
      <Section title="Webhook Definition" id="webhook-definition">
        <p>
          Below is the full JSON structure for a webhook with all available properties:
        </p>
        <CodeBlock language="json" title="Full webhook definition">{`{
  "entity": "order",
  "hook": "after_write",
  "url": "https://api.example.com/webhooks/order-updated",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer {{env.WEBHOOK_SECRET}}",
    "X-API-Key": "{{env.EXTERNAL_API_KEY}}",
    "Content-Type": "application/json"
  },
  "condition": "changes.status != null",
  "async": true,
  "retry": {
    "max_attempts": 5,
    "backoff": "exponential"
  },
  "active": true
}`}</CodeBlock>
        <p style={{ "margin-top": "0.75rem" }}>
          The <C>entity</C> and <C>hook</C> fields determine when the webhook fires.
          The <C>url</C> and <C>method</C> define where and how the request is sent.
          The <C>condition</C> field is optional -- if omitted, the webhook fires on every matching
          event. The <C>retry</C> object controls failure recovery for async webhooks.
        </p>
      </Section>

      {/* ── Hook Types ── */}
      <Section title="Hook Types" id="hook-types">
        <p>
          Four hook types control when the webhook fires relative to the database transaction:
        </p>
        <PropsTable
          columns={["Hook", "Timing", "Can Veto?"]}
          rows={[
            [<C>before_write</C>, "Fires inside the transaction, before the write is committed", "Yes -- non-2xx response rolls back the transaction"],
            [<C>after_write</C>, "Fires after the transaction has been committed", "No -- the write has already succeeded"],
            [<C>before_delete</C>, "Fires inside the transaction, before the delete is committed", "Yes -- non-2xx response rolls back the transaction"],
            [<C>after_delete</C>, "Fires after the delete transaction has been committed", "No -- the delete has already succeeded"],
          ]}
        />
        <InfoBox type="tip">
          <p>
            Use <C>after_write</C> for most integrations (notifications, syncing external systems).
            Reserve <C>before_write</C> for cases where you need an external system to approve or
            validate the operation before it commits.
          </p>
        </InfoBox>
      </Section>

      {/* ── Async vs Sync ── */}
      <Section title="Async vs Sync" id="async-vs-sync">
        <p>
          The <C>async</C> flag (default <C>true</C>) controls whether the webhook fires in the
          background after commit or synchronously inside the transaction:
        </p>
        <PropsTable
          columns={["Aspect", "Async (default)", "Sync"]}
          rows={[
            ["Timing", "Dispatched in background after the transaction commits", "Dispatched inside the transaction before commit"],
            ["Failure impact", "Write succeeds regardless; failure is logged and retried", "Non-2xx response causes the entire transaction to roll back"],
            ["Latency", "Zero added latency to the API response", "API response blocked until the external service responds"],
            ["Retry", "Yes -- background scheduler retries failed deliveries", "No -- failure immediately rolls back; no retry"],
            ["Use case", "Notifications, analytics, syncing external systems", "Fraud detection, external validation, approval gates"],
          ]}
        />
        <InfoBox type="warning">
          <p>
            Sync webhooks add latency to every matching API request and create a failure dependency
            on the external service. If the external service is down, all matching writes will fail.
            Use sync webhooks sparingly and only when you truly need veto power over the operation.
          </p>
        </InfoBox>
      </Section>

      {/* ── Webhook Payload ── */}
      <Section title="Webhook Payload" id="webhook-payload">
        <p>
          When a webhook fires, the engine sends a JSON payload with full context about the event:
        </p>
        <CodeBlock language="json" title="Webhook request body">{`{
  "event": "after_write",
  "entity": "order",
  "action": "update",
  "record": {
    "id": "ord-001",
    "customer_id": "cust-042",
    "status": "shipped",
    "total": 249.99,
    "updated_at": "2025-01-15T10:30:00Z"
  },
  "old": {
    "id": "ord-001",
    "customer_id": "cust-042",
    "status": "processing",
    "total": 249.99,
    "updated_at": "2025-01-15T09:00:00Z"
  },
  "changes": {
    "status": "shipped"
  },
  "user": {
    "id": "usr-007",
    "email": "warehouse@example.com",
    "roles": ["staff"]
  },
  "timestamp": "2025-01-15T10:30:00Z",
  "idempotency_key": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}`}</CodeBlock>
        <p style={{ "margin-top": "0.75rem" }}>
          The <C>record</C> field contains the current state of the record after the write.
          The <C>old</C> field contains the previous state (null on create). The <C>changes</C> field
          contains only the fields that were modified. The <C>idempotency_key</C> is a unique
          identifier for the delivery attempt, useful for deduplication on the receiving end.
        </p>
      </Section>

      {/* ── Condition Expressions ── */}
      <Section title="Condition Expressions" id="condition-expressions">
        <p>
          The <C>condition</C> field uses the same expression engine as rules. When present, the
          webhook only fires if the condition evaluates to true. Available variables:
        </p>
        <ul class="help-list">
          <li><C>record</C> -- the current state of the record</li>
          <li><C>old</C> -- the previous state (null on create)</li>
          <li><C>changes</C> -- only the fields that were modified</li>
          <li><C>action</C> -- "create", "update", or "delete"</li>
          <li><C>entity</C> -- the entity name</li>
          <li><C>event</C> -- the hook type (e.g., "after_write")</li>
          <li><C>user</C> -- the authenticated user performing the action</li>
        </ul>
        <CodeBlock language="json" title="Fire only when status changes">{`"condition": "changes.status != null"`}</CodeBlock>
        <CodeBlock language="json" title="Fire only for high-value orders">{`"condition": "record.total > 1000"`}</CodeBlock>
        <CodeBlock language="json" title="Fire only on create">{`"condition": "action == 'create'"`}</CodeBlock>
        <InfoBox type="tip">
          <p>
            Conditions prevent unnecessary HTTP traffic. Always add a condition when the webhook
            should only fire for a subset of events -- it saves network calls and reduces load on
            the receiving service.
          </p>
        </InfoBox>
      </Section>

      {/* ── Header Templates ── */}
      <Section title="Header Templates" id="header-templates">
        <p>
          Webhook headers support the <C>{"{{env.VAR_NAME}}"}</C> template syntax. At dispatch time,
          the engine resolves these placeholders from the server's environment variables. This keeps
          secrets out of the metadata and makes webhooks portable across environments.
        </p>
        <CodeBlock language="json" title="Headers with environment variable templates">{`{
  "headers": {
    "Authorization": "Bearer {{env.PAYMENT_GATEWAY_TOKEN}}",
    "X-API-Key": "{{env.ANALYTICS_API_KEY}}",
    "X-Source": "rocket-backend"
  }
}`}</CodeBlock>
        <InfoBox type="important">
          <p>
            Environment variables are resolved at dispatch time, not at webhook creation time. If the
            variable is not set, the placeholder is sent as-is. Make sure all referenced environment
            variables are configured on the server before the webhook fires.
          </p>
        </InfoBox>
      </Section>

      {/* ── Retry Configuration ── */}
      <Section title="Retry Configuration" id="retry-configuration">
        <p>
          When an async webhook delivery fails (non-2xx response or network error), the engine
          schedules automatic retries based on the <C>retry</C> configuration:
        </p>
        <CodeBlock language="json" title="Retry configuration">{`{
  "retry": {
    "max_attempts": 3,
    "backoff": "exponential"
  }
}`}</CodeBlock>
        <PropsTable
          columns={["Property", "Default", "Description"]}
          rows={[
            [<C>max_attempts</C>, "3", "Maximum number of delivery attempts (including the initial attempt)"],
            [<C>backoff</C>, "\"exponential\"", "Backoff strategy: \"exponential\" (30s x 2^attempt) or \"linear\" (fixed 30s intervals)"],
          ]}
        />
        <p style={{ "margin-top": "0.75rem" }}>
          With exponential backoff, retries are spaced at increasing intervals: 30s, 60s, 120s, 240s,
          and so on. A background scheduler runs every <strong>30 seconds</strong>, picking up any
          webhook logs in <C>retrying</C> status whose <C>next_retry_at</C> has passed.
        </p>
        <p style={{ "margin-top": "0.75rem" }}>
          All delivery attempts are tracked in the <C>_webhook_logs</C> table, including request
          headers, request body, response status, response body, and error messages.
        </p>
        <InfoBox type="note">
          <p>
            Sync webhooks do not retry. If a sync webhook fails, the transaction is rolled back
            immediately and the client receives an error response. Retries only apply to async
            webhooks.
          </p>
        </InfoBox>
      </Section>

      {/* ── Webhook Logs ── */}
      <Section title="Webhook Logs" id="webhook-logs">
        <p>
          Every webhook delivery is recorded in the <C>_webhook_logs</C> table. Use the Admin API
          or Admin UI to view delivery history, diagnose failures, and manually retry failed
          deliveries.
        </p>
        <EndpointBlock method="GET" url="/api/:app/_admin/webhook-logs" description="List logs (filterable by webhook_id, status, entity)" />
        <EndpointBlock method="GET" url="/api/:app/_admin/webhook-logs/:id" description="Get a single log entry with full request/response details" />
        <EndpointBlock method="POST" url="/api/:app/_admin/webhook-logs/:id/retry" description="Manually retry a failed delivery" />
        <p style={{ "margin-top": "0.75rem" }}>
          Each log entry tracks its delivery status through these states:
        </p>
        <PropsTable
          columns={["Status", "Description"]}
          rows={[
            [<C>pending</C>, "Initial state. The delivery has been queued but not yet attempted."],
            [<C>delivered</C>, "The external service returned a 2xx response. Delivery succeeded."],
            [<C>retrying</C>, "The delivery failed but retries remain. The scheduler will attempt again at next_retry_at."],
            [<C>failed</C>, "All retry attempts exhausted. The delivery is permanently failed."],
          ]}
        />
        <InfoBox type="tip">
          <p>
            Use the manual retry endpoint to re-attempt a failed delivery after fixing the external
            service. This resets the attempt counter and schedules an immediate retry.
          </p>
        </InfoBox>
      </Section>

      {/* ── Examples ── */}
      <Section title="Examples" id="examples">
        <h3>Async: Payment Notification</h3>
        <p>
          Notify a payment service after an order is created or updated. Fires only when the status
          changes to "paid". Retries up to 5 times with exponential backoff.
        </p>
        <CodeBlock language="json" title="Payment notification webhook (async, after_write)">{`{
  "entity": "order",
  "hook": "after_write",
  "url": "https://payments.example.com/hooks/order-paid",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer {{env.PAYMENT_SERVICE_TOKEN}}",
    "Content-Type": "application/json"
  },
  "condition": "changes.status != null && record.status == 'paid'",
  "async": true,
  "retry": {
    "max_attempts": 5,
    "backoff": "exponential"
  },
  "active": true
}`}</CodeBlock>

        <h3 style={{ "margin-top": "1.5rem" }}>Sync: Fraud Detection</h3>
        <p>
          Call an external fraud detection service before an order is committed. If the service
          returns a non-2xx response, the order creation is rolled back. No retries -- the client
          receives an immediate error.
        </p>
        <CodeBlock language="json" title="Fraud detection webhook (sync, before_write)">{`{
  "entity": "order",
  "hook": "before_write",
  "url": "https://fraud.example.com/check",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer {{env.FRAUD_SERVICE_KEY}}",
    "Content-Type": "application/json"
  },
  "condition": "action == 'create' && record.total > 500",
  "async": false,
  "retry": {
    "max_attempts": 1,
    "backoff": "exponential"
  },
  "active": true
}`}</CodeBlock>
        <InfoBox type="warning">
          <p>
            The fraud detection webhook is synchronous -- it will block the API response until the
            external service replies. If the fraud service is slow or down, order creation will fail
            or be delayed. Consider adding a timeout on the receiving service side.
          </p>
        </InfoBox>
      </Section>
    </div>
  );
}
