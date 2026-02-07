package multiapp

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"rocket-backend/internal/auth"
	"rocket-backend/internal/engine"
	"rocket-backend/internal/metadata"
)

// AppResolverMiddleware extracts the :app parameter, looks up the AppContext,
// and attaches it to the request via c.Locals("appCtx").
func AppResolverMiddleware(manager *AppManager) fiber.Handler {
	return func(c *fiber.Ctx) error {
		appName := c.Params("app")
		if appName == "" {
			return engine.NewAppError("APP_NOT_FOUND", 404, "App name is required")
		}

		ac, err := manager.Get(c.Context(), appName)
		if err != nil {
			return engine.NewAppError("APP_NOT_FOUND", 404, "App not found: "+appName)
		}

		c.Locals("appCtx", ac)
		return c.Next()
	}
}

// GetAppCtx extracts the AppContext from a Fiber context.
func GetAppCtx(c *fiber.Ctx) *AppContext {
	ac, _ := c.Locals("appCtx").(*AppContext)
	return ac
}

// AppAuthMiddleware validates JWT tokens using the app's JWT secret first,
// then falls back to the platform JWT secret. Platform admin tokens get admin role.
func AppAuthMiddleware(platformJWTSecret string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		header := c.Get("Authorization")
		if header == "" {
			return engine.UnauthorizedError("Missing auth token")
		}

		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			return engine.UnauthorizedError("Invalid auth header format")
		}

		token := parts[1]
		ac := GetAppCtx(c)

		// Try app-scoped JWT secret first
		if ac != nil {
			claims, err := auth.ParseAccessToken(token, ac.JWTSecret)
			if err == nil {
				c.Locals("user", &metadata.UserContext{
					ID:    claims.Subject,
					Roles: claims.Roles,
				})
				return c.Next()
			}
		}

		// Fall back to platform JWT secret
		claims, err := auth.ParseAccessToken(token, platformJWTSecret)
		if err != nil {
			return engine.UnauthorizedError("Invalid or expired token")
		}

		// Platform admin gets admin role in any app
		c.Locals("user", &metadata.UserContext{
			ID:    claims.Subject,
			Roles: append(claims.Roles, "admin"),
		})

		return c.Next()
	}
}

// PlatformAuthMiddleware validates JWT tokens using only the platform JWT secret.
func PlatformAuthMiddleware(platformJWTSecret string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		header := c.Get("Authorization")
		if header == "" {
			return engine.UnauthorizedError("Missing auth token")
		}

		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			return engine.UnauthorizedError("Invalid auth header format")
		}

		claims, err := auth.ParseAccessToken(parts[1], platformJWTSecret)
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
