package multiapp

import (
	"context"
	"fmt"
	"regexp"
	"time"

	"github.com/gofiber/fiber/v2"

	"rocket-backend/internal/auth"
	"rocket-backend/internal/config"
	"rocket-backend/internal/engine"
	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

var validAppNameRe = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,62}$`)

// PlatformHandler handles platform management endpoints.
type PlatformHandler struct {
	store    *store.Store
	jwtSecret string
	manager   *AppManager
	aiConfig  config.AIConfig
}

func NewPlatformHandler(s *store.Store, jwtSecret string, mgr *AppManager, aiCfg config.AIConfig) *PlatformHandler {
	return &PlatformHandler{store: s, jwtSecret: jwtSecret, manager: mgr, aiConfig: aiCfg}
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
	pAdmin.Get("/ai/status", h.AIStatus)
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

	pb := h.store.Dialect.NewParamBuilder()
	user, err := store.QueryRow(ctx, h.store.DB,
		fmt.Sprintf("SELECT id, email, password_hash, roles, active FROM _platform_users WHERE email = %s", pb.Add(body.Email)),
		pb.Params()...)
	if err != nil {
		return engine.UnauthorizedError("Invalid email or password")
	}

	active := toBool(user["active"])
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

	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(ctx, h.store.DB,
		fmt.Sprintf(`SELECT rt.id, rt.user_id, rt.expires_at, u.roles, u.active
		 FROM _platform_refresh_tokens rt
		 JOIN _platform_users u ON u.id = rt.user_id
		 WHERE rt.token = %s`, pb.Add(body.RefreshToken)),
		pb.Params()...)
	if err != nil {
		return engine.UnauthorizedError("Invalid refresh token")
	}

	expiresAt, _ := row["expires_at"].(time.Time)
	if time.Now().After(expiresAt) {
		pb2 := h.store.Dialect.NewParamBuilder()
		_, _ = store.Exec(ctx, h.store.DB,
			fmt.Sprintf("DELETE FROM _platform_refresh_tokens WHERE token = %s", pb2.Add(body.RefreshToken)),
			pb2.Params()...)
		return engine.UnauthorizedError("Refresh token expired")
	}

	active := toBool(row["active"])
	if !active {
		return engine.UnauthorizedError("Account is disabled")
	}

	tokenID, _ := row["id"].(string)
	pb3 := h.store.Dialect.NewParamBuilder()
	_, _ = store.Exec(ctx, h.store.DB,
		fmt.Sprintf("DELETE FROM _platform_refresh_tokens WHERE id = %s", pb3.Add(tokenID)),
		pb3.Params()...)

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

	pb := h.store.Dialect.NewParamBuilder()
	_, _ = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("DELETE FROM _platform_refresh_tokens WHERE token = %s", pb.Add(body.RefreshToken)),
		pb.Params()...)

	return c.JSON(fiber.Map{"message": "Logged out"})
}

// --- AI Status ---

func (h *PlatformHandler) AIStatus(c *fiber.Ctx) error {
	configured := h.aiConfig.Configured()
	model := ""
	if configured {
		model = h.aiConfig.Model
	}
	return c.JSON(fiber.Map{
		"data": fiber.Map{
			"configured": configured,
			"model":      model,
		},
	})
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
		DBDriver    string `json:"db_driver"`
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
	if body.DBDriver != "" && body.DBDriver != "postgres" && body.DBDriver != "sqlite" {
		return engine.NewAppError("VALIDATION_FAILED", 422, "db_driver must be 'postgres' or 'sqlite'")
	}

	ac, err := h.manager.Create(c.Context(), body.Name, body.DisplayName, body.DBDriver)
	if err != nil {
		return engine.NewAppError("INTERNAL_ERROR", 500, "Failed to create app: "+err.Error())
	}

	return c.Status(201).JSON(fiber.Map{"data": fiber.Map{
		"name":         ac.Name,
		"display_name": body.DisplayName,
		"db_name":      ac.DBName,
		"db_driver":    ac.Store.Dialect.Name(),
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

	pb := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(ctx, h.store.DB,
		fmt.Sprintf(`INSERT INTO _platform_refresh_tokens (user_id, token, expires_at) VALUES (%s, %s, %s)`,
			pb.Add(userID), pb.Add(refreshToken), pb.Add(expiresAt)),
		pb.Params()...)
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
	case string:
		return metadata.ParseStringArray(roles)
	case []byte:
		return metadata.ParseStringArray(roles)
	default:
		return []string{}
	}
}

// toBool converts various types to bool (SQLite returns INTEGER for BOOLEAN).
func toBool(v any) bool {
	switch val := v.(type) {
	case bool:
		return val
	case int64:
		return val != 0
	case int:
		return val != 0
	default:
		return false
	}
}
