package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"

	"rocket-backend/internal/engine"
	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

// AuthHandler handles authentication endpoints.
type AuthHandler struct {
	store     *store.Store
	jwtSecret string
}

// NewAuthHandler creates a new AuthHandler.
func NewAuthHandler(s *store.Store, jwtSecret string) *AuthHandler {
	return &AuthHandler{store: s, jwtSecret: jwtSecret}
}

// Login handles POST /api/auth/login.
func (h *AuthHandler) Login(c *fiber.Ctx) error {
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

	// Look up user by email
	user, err := h.findUserByEmail(ctx, body.Email)
	if err != nil {
		return engine.UnauthorizedError("Invalid email or password")
	}

	// Check if user is active
	active := toBool(user["active"])
	if !active {
		return engine.UnauthorizedError("Account is disabled")
	}

	// Verify password
	passwordHash, _ := user["password_hash"].(string)
	if !CheckPassword(body.Password, passwordHash) {
		return engine.UnauthorizedError("Invalid email or password")
	}

	// Extract user info
	userID, _ := user["id"].(string)
	roles := extractRoles(user["roles"])

	// Generate tokens
	pair, err := h.generateTokenPair(ctx, userID, roles)
	if err != nil {
		return err
	}

	return c.JSON(fiber.Map{"data": pair})
}

// Refresh handles POST /api/auth/refresh.
func (h *AuthHandler) Refresh(c *fiber.Ctx) error {
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

	// Look up refresh token
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(ctx, h.store.DB,
		fmt.Sprintf(`SELECT rt.id, rt.user_id, rt.expires_at, u.roles, u.active
		 FROM _refresh_tokens rt
		 JOIN _users u ON u.id = rt.user_id
		 WHERE rt.token = %s`, pb.Add(body.RefreshToken)), pb.Params()...)
	if err != nil {
		return engine.UnauthorizedError("Invalid refresh token")
	}

	// Check expiration
	expiresAt, _ := row["expires_at"].(time.Time)
	if time.Now().After(expiresAt) {
		// Delete expired token
		pb2 := h.store.Dialect.NewParamBuilder()
		_, _ = store.Exec(ctx, h.store.DB,
			fmt.Sprintf("DELETE FROM _refresh_tokens WHERE token = %s", pb2.Add(body.RefreshToken)), pb2.Params()...)
		return engine.UnauthorizedError("Refresh token expired")
	}

	// Check user is active
	active := toBool(row["active"])
	if !active {
		return engine.UnauthorizedError("Account is disabled")
	}

	// Delete the used refresh token (rotation)
	tokenID, _ := row["id"].(string)
	pb3 := h.store.Dialect.NewParamBuilder()
	_, _ = store.Exec(ctx, h.store.DB,
		fmt.Sprintf("DELETE FROM _refresh_tokens WHERE id = %s", pb3.Add(tokenID)), pb3.Params()...)

	// Generate new token pair
	userID, _ := row["user_id"].(string)
	roles := extractRoles(row["roles"])

	pair, err := h.generateTokenPair(ctx, userID, roles)
	if err != nil {
		return err
	}

	return c.JSON(fiber.Map{"data": pair})
}

// Logout handles POST /api/auth/logout.
func (h *AuthHandler) Logout(c *fiber.Ctx) error {
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
		fmt.Sprintf("DELETE FROM _refresh_tokens WHERE token = %s", pb.Add(body.RefreshToken)), pb.Params()...)

	return c.JSON(fiber.Map{"message": "Logged out"})
}

// RegisterAuthRoutes registers auth routes on the given Fiber app.
func RegisterAuthRoutes(app *fiber.App, h *AuthHandler) {
	auth := app.Group("/api/auth")
	auth.Post("/login", h.Login)
	auth.Post("/refresh", h.Refresh)
	auth.Post("/logout", h.Logout)
}

// --- helpers ---

func (h *AuthHandler) findUserByEmail(ctx context.Context, email string) (map[string]any, error) {
	pb := h.store.Dialect.NewParamBuilder()
	return store.QueryRow(ctx, h.store.DB,
		fmt.Sprintf("SELECT id, email, password_hash, roles, active FROM _users WHERE email = %s", pb.Add(email)), pb.Params()...)
}

func (h *AuthHandler) generateTokenPair(ctx context.Context, userID string, roles []string) (*TokenPair, error) {
	accessToken, err := GenerateAccessToken(userID, roles, h.jwtSecret)
	if err != nil {
		return nil, engine.NewAppError("INTERNAL_ERROR", 500, "Failed to generate access token")
	}

	refreshToken := GenerateRefreshToken()
	expiresAt := time.Now().Add(RefreshTokenTTL)

	pb := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(ctx, h.store.DB,
		fmt.Sprintf(`INSERT INTO _refresh_tokens (user_id, token, expires_at) VALUES (%s, %s, %s)`,
			pb.Add(userID), pb.Add(refreshToken), pb.Add(expiresAt)),
		pb.Params()...)
	if err != nil {
		return nil, engine.NewAppError("INTERNAL_ERROR", 500, "Failed to store refresh token")
	}

	return &TokenPair{
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
