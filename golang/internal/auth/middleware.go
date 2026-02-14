package auth

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"rocket-backend/internal/engine"
	"rocket-backend/internal/instrument"
	"rocket-backend/internal/metadata"
)

// AuthMiddleware returns a Fiber middleware that validates JWT tokens
// and sets the UserContext on the request.
func AuthMiddleware(secret string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		ctx := c.UserContext()
		ctx, span := instrument.GetInstrumenter(ctx).StartSpan(ctx, "auth", "middleware", "auth.validate")
		defer span.End()
		c.SetUserContext(ctx)

		header := c.Get("Authorization")
		if header == "" {
			span.SetStatus("error")
			span.SetMetadata("error", "missing auth token")
			return engine.UnauthorizedError("Missing auth token")
		}

		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			span.SetStatus("error")
			span.SetMetadata("error", "invalid auth header format")
			return engine.UnauthorizedError("Invalid auth header format")
		}

		claims, err := ParseAccessToken(parts[1], secret)
		if err != nil {
			span.SetStatus("error")
			span.SetMetadata("error", "invalid or expired token")
			return engine.UnauthorizedError("Invalid or expired token")
		}

		c.Locals("user", &metadata.UserContext{
			ID:    claims.Subject,
			Roles: claims.Roles,
		})

		span.SetStatus("ok")
		span.SetMetadata("user_id", claims.Subject)
		return c.Next()
	}
}

// RequireAdmin is a Fiber middleware that checks the authenticated user has the admin role.
func RequireAdmin() fiber.Handler {
	return func(c *fiber.Ctx) error {
		user, ok := c.Locals("user").(*metadata.UserContext)
		if !ok || user == nil {
			return engine.UnauthorizedError("Missing auth token")
		}
		if !user.IsAdmin() {
			return engine.ForbiddenError("Admin access required")
		}
		return c.Next()
	}
}

// GetUser extracts the UserContext from a Fiber context.
func GetUser(c *fiber.Ctx) *metadata.UserContext {
	user, _ := c.Locals("user").(*metadata.UserContext)
	return user
}
