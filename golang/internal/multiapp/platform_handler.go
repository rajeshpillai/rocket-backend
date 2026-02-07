package multiapp

import (
	"context"
	"regexp"
	"time"

	"github.com/gofiber/fiber/v2"

	"rocket-backend/internal/auth"
	"rocket-backend/internal/engine"
	"rocket-backend/internal/store"
)

var validAppNameRe = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,62}$`)

// PlatformHandler handles platform management endpoints.
type PlatformHandler struct {
	store     *store.Store
	jwtSecret string
	manager   *AppManager
}

func NewPlatformHandler(s *store.Store, jwtSecret string, mgr *AppManager) *PlatformHandler {
	return &PlatformHandler{store: s, jwtSecret: jwtSecret, manager: mgr}
}

// RegisterPlatformRoutes registers all platform routes.
func RegisterPlatformRoutes(app *fiber.App, h *PlatformHandler, platformAuthMW fiber.Handler) {
	// Platform auth (no auth required)
	pAuth := app.Group("/api/_platform/auth")
	pAuth.Post("/login", h.Login)
	pAuth.Post("/refresh", h.Refresh)
	pAuth.Post("/logout", h.Logout)

	// Platform admin (auth required)
	pAdmin := app.Group("/api/_platform", platformAuthMW)
	pAdmin.Get("/apps", h.ListApps)
	pAdmin.Post("/apps", h.CreateApp)
	pAdmin.Get("/apps/:name", h.GetApp)
	pAdmin.Delete("/apps/:name", h.DeleteApp)
}

// --- Auth endpoints (platform users) ---

func (h *PlatformHandler) Login(c *fiber.Ctx) error {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := c.BodyParser(&body); err != nil {
		return engine.NewAppError("INVALID_PAYLOAD", 400, "Invalid request body")
	}
	if body.Email == "" || body.Password == "" {
		return engine.UnauthorizedError("Email and password are required")
	}

	ctx := c.Context()

	user, err := store.QueryRow(ctx, h.store.Pool,
		"SELECT id, email, password_hash, roles, active FROM _platform_users WHERE email = $1", body.Email)
	if err != nil {
		return engine.UnauthorizedError("Invalid email or password")
	}

	active, _ := user["active"].(bool)
	if !active {
		return engine.UnauthorizedError("Account is disabled")
	}

	passwordHash, _ := user["password_hash"].(string)
	if !auth.CheckPassword(body.Password, passwordHash) {
		return engine.UnauthorizedError("Invalid email or password")
	}

	userID, _ := user["id"].(string)
	roles := extractRoles(user["roles"])

	pair, err := h.generateTokenPair(ctx, userID, roles)
	if err != nil {
		return err
	}

	return c.JSON(fiber.Map{"data": pair})
}

func (h *PlatformHandler) Refresh(c *fiber.Ctx) error {
	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.BodyParser(&body); err != nil {
		return engine.NewAppError("INVALID_PAYLOAD", 400, "Invalid request body")
	}
	if body.RefreshToken == "" {
		return engine.UnauthorizedError("Refresh token is required")
	}

	ctx := c.Context()

	row, err := store.QueryRow(ctx, h.store.Pool,
		`SELECT rt.id, rt.user_id, rt.expires_at, u.roles, u.active
		 FROM _platform_refresh_tokens rt
		 JOIN _platform_users u ON u.id = rt.user_id
		 WHERE rt.token = $1`, body.RefreshToken)
	if err != nil {
		return engine.UnauthorizedError("Invalid refresh token")
	}

	expiresAt, _ := row["expires_at"].(time.Time)
	if time.Now().After(expiresAt) {
		_, _ = store.Exec(ctx, h.store.Pool,
			"DELETE FROM _platform_refresh_tokens WHERE token = $1", body.RefreshToken)
		return engine.UnauthorizedError("Refresh token expired")
	}

	active, _ := row["active"].(bool)
	if !active {
		return engine.UnauthorizedError("Account is disabled")
	}

	tokenID, _ := row["id"].(string)
	_, _ = store.Exec(ctx, h.store.Pool,
		"DELETE FROM _platform_refresh_tokens WHERE id = $1", tokenID)

	userID, _ := row["user_id"].(string)
	roles := extractRoles(row["roles"])

	pair, err := h.generateTokenPair(ctx, userID, roles)
	if err != nil {
		return err
	}

	return c.JSON(fiber.Map{"data": pair})
}

func (h *PlatformHandler) Logout(c *fiber.Ctx) error {
	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.BodyParser(&body); err != nil {
		return engine.NewAppError("INVALID_PAYLOAD", 400, "Invalid request body")
	}
	if body.RefreshToken == "" {
		return engine.UnauthorizedError("Refresh token is required")
	}

	_, _ = store.Exec(c.Context(), h.store.Pool,
		"DELETE FROM _platform_refresh_tokens WHERE token = $1", body.RefreshToken)

	return c.JSON(fiber.Map{"message": "Logged out"})
}

// --- App CRUD ---

func (h *PlatformHandler) ListApps(c *fiber.Ctx) error {
	apps, err := h.manager.List(c.Context())
	if err != nil {
		return engine.NewAppError("INTERNAL_ERROR", 500, "Failed to list apps")
	}
	return c.JSON(fiber.Map{"data": apps})
}

func (h *PlatformHandler) GetApp(c *fiber.Ctx) error {
	name := c.Params("name")
	info, err := h.manager.GetApp(c.Context(), name)
	if err != nil {
		return engine.NewAppError("NOT_FOUND", 404, "App not found")
	}
	return c.JSON(fiber.Map{"data": info})
}

func (h *PlatformHandler) CreateApp(c *fiber.Ctx) error {
	var body struct {
		Name        string `json:"name"`
		DisplayName string `json:"display_name"`
	}
	if err := c.BodyParser(&body); err != nil {
		return engine.NewAppError("INVALID_PAYLOAD", 400, "Invalid request body")
	}

	if body.Name == "" {
		return engine.NewAppError("VALIDATION_FAILED", 422, "App name is required")
	}
	if !validAppNameRe.MatchString(body.Name) {
		return engine.NewAppError("VALIDATION_FAILED", 422, "App name must be lowercase letters, numbers, hyphens, underscores (start with letter)")
	}
	if body.DisplayName == "" {
		body.DisplayName = body.Name
	}

	ac, err := h.manager.Create(c.Context(), body.Name, body.DisplayName)
	if err != nil {
		return engine.NewAppError("INTERNAL_ERROR", 500, "Failed to create app: "+err.Error())
	}

	return c.Status(201).JSON(fiber.Map{"data": fiber.Map{
		"name":         ac.Name,
		"display_name": body.DisplayName,
		"db_name":      ac.DBName,
		"status":       "active",
	}})
}

func (h *PlatformHandler) DeleteApp(c *fiber.Ctx) error {
	name := c.Params("name")
	if err := h.manager.Delete(c.Context(), name); err != nil {
		return engine.NewAppError("NOT_FOUND", 404, "App not found or failed to delete: "+err.Error())
	}
	return c.JSON(fiber.Map{"message": "App deleted"})
}

// --- helpers ---

func (h *PlatformHandler) generateTokenPair(ctx context.Context, userID string, roles []string) (*auth.TokenPair, error) {
	accessToken, err := auth.GenerateAccessToken(userID, roles, h.jwtSecret)
	if err != nil {
		return nil, engine.NewAppError("INTERNAL_ERROR", 500, "Failed to generate access token")
	}

	refreshToken := auth.GenerateRefreshToken()
	expiresAt := time.Now().Add(auth.RefreshTokenTTL)

	_, err = store.Exec(ctx, h.store.Pool,
		`INSERT INTO _platform_refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
		userID, refreshToken, expiresAt)
	if err != nil {
		return nil, engine.NewAppError("INTERNAL_ERROR", 500, "Failed to store refresh token")
	}

	return &auth.TokenPair{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
	}, nil
}

func extractRoles(v any) []string {
	if v == nil {
		return []string{}
	}
	switch roles := v.(type) {
	case []string:
		return roles
	case []any:
		result := make([]string, 0, len(roles))
		for _, r := range roles {
			if s, ok := r.(string); ok {
				result = append(result, s)
			}
		}
		return result
	default:
		return []string{}
	}
}
