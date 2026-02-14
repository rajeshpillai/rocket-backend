package instrument

import "context"

// NoopInstrumenter discards all spans. Used when instrumentation is disabled
// or when the request is sampled out.
type NoopInstrumenter struct{}

func (n *NoopInstrumenter) StartSpan(ctx context.Context, source, component, action string) (context.Context, Span) {
	return ctx, &NoopSpan{}
}

func (n *NoopInstrumenter) EmitBusinessEvent(ctx context.Context, action, entity, recordID string, metadata map[string]any) {
}

// NoopSpan discards all data.
type NoopSpan struct{}

func (n *NoopSpan) End()                              {}
func (n *NoopSpan) SetStatus(status string)            {}
func (n *NoopSpan) SetMetadata(key string, value any)  {}
func (n *NoopSpan) SetEntity(entity, recordID string)  {}
func (n *NoopSpan) TraceID() string                    { return "" }
func (n *NoopSpan) SpanID() string                     { return "" }
