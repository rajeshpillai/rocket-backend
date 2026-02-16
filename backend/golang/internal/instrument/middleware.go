package instrument

import (
	"math/rand"

	"github.com/gofiber/fiber/v2"

	"rocket-backend/internal/config"
	"rocket-backend/internal/metadata"
)

// Middleware returns a Fiber middleware that sets up tracing for each request.
// It generates (or propagates) a trace ID, creates a root HTTP span, and injects
// the instrumenter into the request context for downstream handlers.
// The getBuffer callback extracts the EventBuffer from the request (e.g. from AppContext),
// avoiding a circular dependency between instrument and multiapp packages.
func Middleware(cfg config.InstrumentationConfig, getBuffer func(c *fiber.Ctx) *EventBuffer) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if !cfg.Enabled {
			return c.Next()
		}

		buffer := getBuffer(c)
		if buffer == nil {
			return c.Next()
		}

		// Sampling: skip tracing for a proportion of requests
		if cfg.SamplingRate < 1.0 && rand.Float64() > cfg.SamplingRate {
			return c.Next()
		}

		// Get or generate trace ID from incoming header
		traceID := c.Get("X-Trace-ID")
		if traceID == "" {
			traceID = newUUID()
		}

		// Set up context with trace ID and instrumenter
		ctx := c.UserContext()
		instrumenter := NewInstrumenter(buffer)
		ctx = WithTraceID(ctx, traceID)
		ctx = WithInstrumenter(ctx, instrumenter)
		c.SetUserContext(ctx)

		// Create root HTTP span
		ctx, span := instrumenter.StartSpan(ctx, "http", "handler", "request")
		span.SetMetadata("method", c.Method())
		span.SetMetadata("path", c.Path())
		c.SetUserContext(ctx)

		// Set trace ID response header
		c.Set("X-Trace-ID", traceID)

		// Execute downstream handlers (auth middleware, route handlers, etc.)
		err := c.Next()

		// After downstream completes, extract user ID from auth middleware
		// and attach to the root span (auth middleware sets c.Locals("user"))
		if user, ok := c.Locals("user").(*metadata.UserContext); ok && user != nil {
			span.SetMetadata("user_id", user.ID)
			// Also update the context so any deferred operations have the user ID
			ctx = WithUserID(c.UserContext(), user.ID)
			c.SetUserContext(ctx)
		}

		// Finalize root span with response status
		statusCode := c.Response().StatusCode()
		span.SetMetadata("status_code", statusCode)
		if statusCode >= 400 {
			span.SetStatus("error")
		} else {
			span.SetStatus("ok")
		}
		span.End()

		return err
	}
}
