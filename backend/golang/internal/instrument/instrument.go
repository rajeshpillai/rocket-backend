package instrument

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Context keys
type ctxKey int

const (
	traceIDKey ctxKey = iota
	parentSpanIDKey
	instrumenterKey
)

type userIDKeyType int

const userIDKey userIDKeyType = 0

// Instrumenter interface defines the tracing API.
type Instrumenter interface {
	StartSpan(ctx context.Context, source, component, action string) (context.Context, Span)
	EmitBusinessEvent(ctx context.Context, action, entity, recordID string, metadata map[string]any)
}

// Span interface represents a timed operation span.
type Span interface {
	End()
	SetStatus(status string)
	SetMetadata(key string, value any)
	SetEntity(entity, recordID string)
	TraceID() string
	SpanID() string
}

// Event represents a row in the _events table.
type Event struct {
	TraceID      string         `json:"trace_id"`
	SpanID       string         `json:"span_id"`
	ParentSpanID *string        `json:"parent_span_id"`
	EventType    string         `json:"event_type"`
	Source       string         `json:"source"`
	Component    string         `json:"component"`
	Action       string         `json:"action"`
	Entity       *string        `json:"entity"`
	RecordID     *string        `json:"record_id"`
	UserID       *string        `json:"user_id"`
	DurationMs   *float64       `json:"duration_ms"`
	Status       *string        `json:"status"`
	Metadata     map[string]any `json:"metadata"`
	CreatedAt    time.Time      `json:"created_at"`
}

// newUUID generates a new UUID v4 string.
func newUUID() string {
	return uuid.New().String()
}

// Context helpers

// WithTraceID sets the trace ID in the context.
func WithTraceID(ctx context.Context, traceID string) context.Context {
	return context.WithValue(ctx, traceIDKey, traceID)
}

// GetTraceID returns the trace ID from the context.
func GetTraceID(ctx context.Context) string {
	if v, ok := ctx.Value(traceIDKey).(string); ok {
		return v
	}
	return ""
}

// WithParentSpanID sets the parent span ID in the context.
func WithParentSpanID(ctx context.Context, spanID string) context.Context {
	return context.WithValue(ctx, parentSpanIDKey, spanID)
}

func getParentSpanID(ctx context.Context) string {
	if v, ok := ctx.Value(parentSpanIDKey).(string); ok {
		return v
	}
	return ""
}

// WithInstrumenter sets the instrumenter in the context.
func WithInstrumenter(ctx context.Context, inst Instrumenter) context.Context {
	return context.WithValue(ctx, instrumenterKey, inst)
}

// GetInstrumenter returns the instrumenter from the context,
// or a NoopInstrumenter if none is set.
func GetInstrumenter(ctx context.Context) Instrumenter {
	if v, ok := ctx.Value(instrumenterKey).(Instrumenter); ok {
		return v
	}
	return &NoopInstrumenter{}
}

// WithUserID sets the user ID in the context for instrumentation.
func WithUserID(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, userIDKey, userID)
}

// getUserID extracts user ID from context (set by instrumentation middleware).
func getUserID(ctx context.Context) *string {
	if v, ok := ctx.Value(userIDKey).(string); ok {
		return &v
	}
	return nil
}

// InstrumenterImpl is the real instrumenter that enqueues events to the buffer.
type InstrumenterImpl struct {
	buffer *EventBuffer
}

// NewInstrumenter creates a new InstrumenterImpl backed by the given buffer.
func NewInstrumenter(buffer *EventBuffer) *InstrumenterImpl {
	return &InstrumenterImpl{buffer: buffer}
}

// StartSpan creates a new span and returns the updated context.
func (i *InstrumenterImpl) StartSpan(ctx context.Context, source, component, action string) (context.Context, Span) {
	traceID := GetTraceID(ctx)
	parentSpanID := getParentSpanID(ctx)
	spanID := newUUID()

	span := &SpanImpl{
		traceID:      traceID,
		spanID:       spanID,
		parentSpanID: parentSpanID,
		source:       source,
		component:    component,
		action:       action,
		startTime:    time.Now(),
		metadata:     make(map[string]any),
		buffer:       i.buffer,
		userID:       getUserID(ctx),
	}

	// Update context so child spans reference this span as parent
	ctx = WithParentSpanID(ctx, spanID)
	return ctx, span
}

// EmitBusinessEvent emits a one-shot business event (no duration tracking).
func (i *InstrumenterImpl) EmitBusinessEvent(ctx context.Context, action, entity, recordID string, metadata map[string]any) {
	traceID := GetTraceID(ctx)
	spanID := newUUID()
	parentSpanID := getParentSpanID(ctx)

	event := Event{
		TraceID:   traceID,
		SpanID:    spanID,
		EventType: "business",
		Source:    "business",
		Component: "api",
		Action:    action,
		Metadata:  metadata,
	}
	if parentSpanID != "" {
		event.ParentSpanID = &parentSpanID
	}
	if entity != "" {
		event.Entity = &entity
	}
	if recordID != "" {
		event.RecordID = &recordID
	}
	if uid := getUserID(ctx); uid != nil {
		event.UserID = uid
	}
	i.buffer.Enqueue(event)
}

// SpanImpl implements the Span interface with timing and metadata.
type SpanImpl struct {
	traceID      string
	spanID       string
	parentSpanID string
	source       string
	component    string
	action       string
	entity       *string
	recordID     *string
	userID       *string
	status       *string
	startTime    time.Time
	metadata     map[string]any
	buffer       *EventBuffer
	mu           sync.Mutex
	ended        bool
}

func (s *SpanImpl) TraceID() string { return s.traceID }
func (s *SpanImpl) SpanID() string  { return s.spanID }

func (s *SpanImpl) SetStatus(status string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status = &status
}

func (s *SpanImpl) SetMetadata(key string, value any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.metadata == nil {
		s.metadata = make(map[string]any)
	}
	s.metadata[key] = value
}

func (s *SpanImpl) SetEntity(entity, recordID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entity = &entity
	if recordID != "" {
		s.recordID = &recordID
	}
}

func (s *SpanImpl) End() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ended {
		return
	}
	s.ended = true

	durationMs := float64(time.Since(s.startTime).Microseconds()) / 1000.0

	event := Event{
		TraceID:    s.traceID,
		SpanID:     s.spanID,
		EventType:  "system",
		Source:     s.source,
		Component:  s.component,
		Action:     s.action,
		Entity:     s.entity,
		RecordID:   s.recordID,
		UserID:     s.userID,
		DurationMs: &durationMs,
		Status:     s.status,
		Metadata:   s.metadata,
	}
	if s.parentSpanID != "" {
		event.ParentSpanID = &s.parentSpanID
	}
	s.buffer.Enqueue(event)
}
