package metadata

// WebhookRetry defines retry behaviour for async webhook delivery.
type WebhookRetry struct {
	MaxAttempts int    `json:"max_attempts"`
	Backoff     string `json:"backoff"` // "exponential" or "linear"
}

// Webhook defines an HTTP callout triggered by entity writes.
type Webhook struct {
	ID        string            `json:"id"`
	Entity    string            `json:"entity"`
	Hook      string            `json:"hook"`   // after_write, before_write, after_delete, before_delete
	URL       string            `json:"url"`
	Method    string            `json:"method"` // POST, PUT, PATCH, GET, DELETE
	Headers   map[string]string `json:"headers"`
	Condition string            `json:"condition"` // expression; empty = always fire
	Async     bool              `json:"async"`
	Retry     WebhookRetry      `json:"retry"`
	Active    bool              `json:"active"`
}
