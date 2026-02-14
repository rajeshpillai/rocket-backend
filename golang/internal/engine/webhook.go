package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/expr-lang/expr"
	"github.com/google/uuid"

	"rocket-backend/internal/instrument"
	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

var webhookHTTPClient = &http.Client{Timeout: 30 * time.Second}

// WebhookPayload is the JSON body sent to webhook endpoints.
type WebhookPayload struct {
	Event          string         `json:"event"`
	Entity         string         `json:"entity"`
	Action         string         `json:"action"` // create, update, delete
	Record         map[string]any `json:"record"`
	Old            map[string]any `json:"old,omitempty"`
	Changes        map[string]any `json:"changes,omitempty"`
	User           map[string]any `json:"user,omitempty"`
	Timestamp      string         `json:"timestamp"`
	IdempotencyKey string         `json:"idempotency_key"`
}

// BuildWebhookPayload constructs the payload for a webhook delivery.
func BuildWebhookPayload(hook, entity, action string, record, old map[string]any, user *metadata.UserContext) *WebhookPayload {
	p := &WebhookPayload{
		Event:          hook,
		Entity:         entity,
		Action:         action,
		Record:         record,
		Timestamp:      time.Now().UTC().Format(time.RFC3339),
		IdempotencyKey: "wh_" + uuid.New().String(),
	}
	if old != nil {
		p.Old = old
		p.Changes = computeChanges(record, old)
	}
	if user != nil {
		p.User = map[string]any{"id": user.ID, "roles": user.Roles}
	}
	return p
}

// computeChanges returns a map of field -> {old, new} for changed fields.
func computeChanges(record, old map[string]any) map[string]any {
	changes := map[string]any{}
	for k, newVal := range record {
		oldVal, exists := old[k]
		if !exists || fmt.Sprintf("%v", oldVal) != fmt.Sprintf("%v", newVal) {
			changes[k] = map[string]any{"old": oldVal, "new": newVal}
		}
	}
	return changes
}

// ResolveHeaders replaces {{env.VAR_NAME}} in header values with os env values.
func ResolveHeaders(headers map[string]string) map[string]string {
	resolved := make(map[string]string, len(headers))
	for k, v := range headers {
		resolved[k] = resolveEnvVars(v)
	}
	return resolved
}

func resolveEnvVars(s string) string {
	for {
		start := strings.Index(s, "{{env.")
		if start == -1 {
			return s
		}
		end := strings.Index(s[start:], "}}")
		if end == -1 {
			return s
		}
		end += start
		varName := s[start+6 : end]
		envVal := os.Getenv(varName)
		s = s[:start] + envVal + s[end+2:]
	}
}

// EvaluateWebhookCondition evaluates a webhook's condition expression.
// Empty condition always returns true. Uses lazy compilation with caching.
func EvaluateWebhookCondition(wh *metadata.Webhook, payload *WebhookPayload) (bool, error) {
	if wh.Condition == "" {
		return true, nil
	}

	env := map[string]any{
		"record":  payload.Record,
		"old":     payload.Old,
		"changes": payload.Changes,
		"action":  payload.Action,
		"entity":  payload.Entity,
		"event":   payload.Event,
	}
	if payload.User != nil {
		env["user"] = payload.User
	}

	// Lazy-compile and cache the condition program
	if wh.CompiledCondition == nil {
		prog, err := expr.Compile(wh.Condition, expr.AsBool())
		if err != nil {
			return false, fmt.Errorf("compile webhook condition: %w", err)
		}
		wh.CompiledCondition = prog
	}
	result, err := expr.Run(wh.CompiledCondition, env)
	if err != nil {
		return false, fmt.Errorf("evaluate webhook condition: %w", err)
	}
	b, ok := result.(bool)
	if !ok {
		return false, fmt.Errorf("webhook condition did not return bool")
	}
	return b, nil
}

// DispatchResult holds the outcome of a single webhook HTTP call.
type DispatchResult struct {
	StatusCode   int
	ResponseBody string
	Error        string
}

// DispatchWebhook performs the HTTP call. url/method/headers are resolved values.
func DispatchWebhook(ctx context.Context, url, method string, headers map[string]string, bodyJSON []byte) *DispatchResult {
	ctx, span := instrument.GetInstrumenter(ctx).StartSpan(ctx, "webhook", "dispatcher", "webhook.dispatch")
	defer span.End()
	span.SetMetadata("url", url)
	span.SetMetadata("method", method)

	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(bodyJSON))
	if err != nil {
		span.SetStatus("error")
		span.SetMetadata("error", fmt.Sprintf("build request: %v", err))
		return &DispatchResult{Error: fmt.Sprintf("build request: %v", err)}
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := webhookHTTPClient.Do(req)
	if err != nil {
		span.SetStatus("error")
		span.SetMetadata("error", fmt.Sprintf("http call: %v", err))
		return &DispatchResult{Error: fmt.Sprintf("http call: %v", err)}
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024)) // max 64KB

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		span.SetStatus("ok")
	} else {
		span.SetStatus("error")
		span.SetMetadata("error", fmt.Sprintf("HTTP %d", resp.StatusCode))
	}
	span.SetMetadata("status_code", resp.StatusCode)

	return &DispatchResult{
		StatusCode:   resp.StatusCode,
		ResponseBody: string(respBody),
	}
}

// LogWebhookDelivery inserts a row into _webhook_logs.
func LogWebhookDelivery(ctx context.Context, q store.Querier, dialect store.Dialect, wh *metadata.Webhook, payload *WebhookPayload, headers map[string]string, bodyJSON []byte, result *DispatchResult) {
	status := "delivered"
	errMsg := result.Error
	if errMsg != "" || result.StatusCode < 200 || result.StatusCode >= 300 {
		if wh.Retry.MaxAttempts > 1 {
			status = "retrying"
		} else {
			status = "failed"
		}
		if errMsg == "" {
			errMsg = fmt.Sprintf("HTTP %d", result.StatusCode)
		}
	}

	headersJSON, _ := json.Marshal(headers)
	var nextRetry *time.Time
	if status == "retrying" {
		t := time.Now().Add(30 * time.Second)
		nextRetry = &t
	}

	pb := dialect.NewParamBuilder()
	id := store.GenerateUUID()
	_, err := store.Exec(ctx, q,
		fmt.Sprintf(`INSERT INTO _webhook_logs (id, webhook_id, entity, hook, url, method, request_headers, request_body,
		 response_status, response_body, status, attempt, max_attempts, next_retry_at, error, idempotency_key)
		 VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)`,
			pb.Add(id), pb.Add(wh.ID), pb.Add(wh.Entity), pb.Add(wh.Hook), pb.Add(wh.URL), pb.Add(wh.Method),
			pb.Add(string(headersJSON)), pb.Add(string(bodyJSON)),
			pb.Add(result.StatusCode), pb.Add(result.ResponseBody),
			pb.Add(status), pb.Add(1), pb.Add(wh.Retry.MaxAttempts), pb.Add(nextRetry), pb.Add(errMsg), pb.Add(payload.IdempotencyKey)),
		pb.Params()...)
	if err != nil {
		log.Printf("ERROR: failed to log webhook delivery for %s: %v", wh.ID, err)
	}
}

// FireAsyncWebhooks dispatches async webhooks for an entity hook after commit.
// Runs each webhook in a separate goroutine. Does not block the caller.
func FireAsyncWebhooks(ctx context.Context, s *store.Store, reg *metadata.Registry,
	hook, entity, action string, record, old map[string]any, user *metadata.UserContext) {

	webhooks := reg.GetWebhooksForEntityHook(entity, hook)
	if len(webhooks) == 0 {
		return
	}

	payload := BuildWebhookPayload(hook, entity, action, record, old, user)

	for _, wh := range webhooks {
		if !wh.Async {
			continue
		}

		fire, err := EvaluateWebhookCondition(wh, payload)
		if err != nil {
			log.Printf("ERROR: webhook %s condition evaluation: %v", wh.ID, err)
			continue
		}
		if !fire {
			continue
		}

		// Dispatch in background goroutine
		go func(wh *metadata.Webhook) {
			headers := ResolveHeaders(wh.Headers)
			bodyJSON, _ := json.Marshal(payload)
			result := DispatchWebhook(context.Background(), wh.URL, wh.Method, headers, bodyJSON)
			LogWebhookDelivery(context.Background(), s.DB, s.Dialect, wh, payload, headers, bodyJSON, result)
		}(wh)
	}
}

// FireSyncWebhooks dispatches sync webhooks inside a transaction.
// Returns an error if any webhook fails (non-2xx or network error), causing rollback.
func FireSyncWebhooks(ctx context.Context, tx store.Querier, dialect store.Dialect, reg *metadata.Registry,
	hook, entity, action string, record, old map[string]any, user *metadata.UserContext) error {

	webhooks := reg.GetWebhooksForEntityHook(entity, hook)
	if len(webhooks) == 0 {
		return nil
	}

	payload := BuildWebhookPayload(hook, entity, action, record, old, user)

	for _, wh := range webhooks {
		if wh.Async {
			continue // skip async webhooks in sync path
		}

		fire, err := EvaluateWebhookCondition(wh, payload)
		if err != nil {
			return fmt.Errorf("webhook %s condition: %w", wh.ID, err)
		}
		if !fire {
			continue
		}

		headers := ResolveHeaders(wh.Headers)
		bodyJSON, _ := json.Marshal(payload)
		result := DispatchWebhook(ctx, wh.URL, wh.Method, headers, bodyJSON)

		// Log delivery (inside the transaction)
		LogWebhookDelivery(ctx, tx, dialect, wh, payload, headers, bodyJSON, result)

		if result.Error != "" {
			return fmt.Errorf("webhook %s failed: %s", wh.ID, result.Error)
		}
		if result.StatusCode < 200 || result.StatusCode >= 300 {
			return fmt.Errorf("webhook %s returned HTTP %d: %s", wh.ID, result.StatusCode, result.ResponseBody)
		}
	}

	return nil
}

// DispatchWebhookDirect fires a single webhook with a given URL/method/headers (for state machine and workflow actions).
// Returns the result without logging.
func DispatchWebhookDirect(ctx context.Context, url, method string, headers map[string]string, body []byte) *DispatchResult {
	if headers == nil {
		headers = map[string]string{}
	}
	resolved := ResolveHeaders(headers)
	return DispatchWebhook(ctx, url, method, resolved, body)
}
