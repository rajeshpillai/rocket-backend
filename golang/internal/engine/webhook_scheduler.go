package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"time"

	"rocket-backend/internal/store"
)

// WebhookScheduler retries failed webhook deliveries on a background interval.
type WebhookScheduler struct {
	store  *store.Store
	ticker *time.Ticker
	done   chan struct{}
}

func NewWebhookScheduler(s *store.Store) *WebhookScheduler {
	return &WebhookScheduler{store: s}
}

// Start begins the background ticker for retrying webhook deliveries.
func (ws *WebhookScheduler) Start() {
	ws.ticker = time.NewTicker(30 * time.Second)
	ws.done = make(chan struct{})
	go ws.run()
	log.Println("Webhook scheduler started (30s interval)")
}

// Stop halts the background ticker.
func (ws *WebhookScheduler) Stop() {
	if ws.ticker != nil {
		ws.ticker.Stop()
	}
	if ws.done != nil {
		close(ws.done)
	}
}

func (ws *WebhookScheduler) run() {
	for {
		select {
		case <-ws.done:
			return
		case <-ws.ticker.C:
			ws.processRetries()
		}
	}
}

func (ws *WebhookScheduler) processRetries() {
	ctx := context.Background()

	rows, err := store.QueryRows(ctx, ws.store.Pool,
		`SELECT id, webhook_id, entity, hook, url, method, request_headers, request_body,
		        status, attempt, max_attempts, idempotency_key
		 FROM _webhook_logs
		 WHERE status = 'retrying' AND next_retry_at < NOW()
		 ORDER BY next_retry_at ASC
		 LIMIT 50`)
	if err != nil {
		log.Printf("ERROR: webhook scheduler query failed: %v", err)
		return
	}

	for _, row := range rows {
		ws.retryDelivery(ctx, row)
	}
}

func (ws *WebhookScheduler) retryDelivery(ctx context.Context, row map[string]any) {
	logID := fmt.Sprintf("%v", row["id"])
	attempt := toInt(row["attempt"]) + 1
	maxAttempts := toInt(row["max_attempts"])
	url := fmt.Sprintf("%v", row["url"])
	method := fmt.Sprintf("%v", row["method"])

	// Parse request headers
	headers := map[string]string{}
	if h, ok := row["request_headers"]; ok && h != nil {
		switch v := h.(type) {
		case string:
			json.Unmarshal([]byte(v), &headers)
		case map[string]any:
			for k, val := range v {
				headers[k] = fmt.Sprintf("%v", val)
			}
		}
	}

	// Parse request body
	var bodyJSON []byte
	if b, ok := row["request_body"]; ok && b != nil {
		switch v := b.(type) {
		case string:
			bodyJSON = []byte(v)
		default:
			bodyJSON, _ = json.Marshal(v)
		}
	}

	// Dispatch
	resolved := ResolveHeaders(headers)
	result := DispatchWebhook(ctx, url, method, resolved, bodyJSON)

	// Determine new status
	newStatus := "delivered"
	errMsg := result.Error
	if errMsg != "" || result.StatusCode < 200 || result.StatusCode >= 300 {
		if errMsg == "" {
			errMsg = fmt.Sprintf("HTTP %d", result.StatusCode)
		}
		if attempt >= maxAttempts {
			newStatus = "failed"
		} else {
			newStatus = "retrying"
		}
	}

	// Compute next retry time with exponential backoff: 30s × 2^attempt
	var nextRetry *time.Time
	if newStatus == "retrying" {
		backoff := time.Duration(math.Pow(2, float64(attempt))) * 30 * time.Second
		t := time.Now().Add(backoff)
		nextRetry = &t
	}

	_, err := store.Exec(ctx, ws.store.Pool,
		`UPDATE _webhook_logs
		 SET status = $1, attempt = $2, response_status = $3, response_body = $4,
		     error = $5, next_retry_at = $6, updated_at = NOW()
		 WHERE id = $7`,
		newStatus, attempt, result.StatusCode, result.ResponseBody, errMsg, nextRetry, logID)
	if err != nil {
		log.Printf("ERROR: webhook scheduler update for %s: %v", logID, err)
		return
	}

	if newStatus == "delivered" {
		log.Printf("Webhook retry delivered: log=%s attempt=%d", logID, attempt)
	} else if newStatus == "failed" {
		log.Printf("Webhook retry exhausted: log=%s attempt=%d/%d", logID, attempt, maxAttempts)
	}
}

func toInt(v any) int {
	switch val := v.(type) {
	case int:
		return val
	case int64:
		return int(val)
	case float64:
		return int(val)
	case json.Number:
		n, _ := val.Int64()
		return int(n)
	default:
		return 0
	}
}
