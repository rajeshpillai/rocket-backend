package auth

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"rocket-backend/internal/engine"
	"rocket-backend/internal/metadata"
)

// AuthMiddleware returns a Fiber middleware that validates JWT tokens
// and sets the UserContext on the request.
func AuthMiddleware(secret string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		header := c.Get("Authorization")
		if header == "" {
			return engine.UnauthorizedError("Missing auth token")
		}

		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			return engine.UnauthorizedError("Invalid auth header format")
		}

		claims, err := ParseAccessToken(parts[1], secret)
		if err != nil {
			return engine.UnauthorizedError("Invalid or expired token")
		}

		c.Locals("user", &metadata.UserContext{
			ID:    claims.Subject,
			Roles: claims.Roles,
		})

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
