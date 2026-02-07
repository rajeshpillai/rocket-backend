package auth

import (
	"context"
	"time"

	"github.com/gofiber/fiber/v2"

	"rocket-backend/internal/engine"
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
	active, _ := user["active"].(bool)
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
	row, err := store.QueryRow(ctx, h.store.Pool,
		`SELECT rt.id, rt.user_id, rt.expires_at, u.roles, u.active
		 FROM _refresh_tokens rt
		 JOIN _users u ON u.id = rt.user_id
		 WHERE rt.token = $1`, body.RefreshToken)
	if err != nil {
		return engine.UnauthorizedError("Invalid refresh token")
	}

	// Check expiration
	expiresAt, _ := row["expires_at"].(time.Time)
	if time.Now().After(expiresAt) {
		// Delete expired token
		_, _ = store.Exec(ctx, h.store.Pool,
			"DELETE FROM _refresh_tokens WHERE token = $1", body.RefreshToken)
		return engine.UnauthorizedError("Refresh token expired")
	}

	// Check user is active
	active, _ := row["active"].(bool)
	if !active {
		return engine.UnauthorizedError("Account is disabled")
	}

	// Delete the used refresh token (rotation)
	tokenID, _ := row["id"].(string)
	_, _ = store.Exec(ctx, h.store.Pool,
		"DELETE FROM _refresh_tokens WHERE id = $1", tokenID)

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

	_, _ = store.Exec(c.Context(), h.store.Pool,
		"DELETE FROM _refresh_tokens WHERE token = $1", body.RefreshToken)

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
	return store.QueryRow(ctx, h.store.Pool,
		"SELECT id, email, password_hash, roles, active FROM _users WHERE email = $1", email)
}

func (h *AuthHandler) generateTokenPair(ctx context.Context, userID string, roles []string) (*TokenPair, error) {
	accessToken, err := GenerateAccessToken(userID, roles, h.jwtSecret)
	if err != nil {
		return nil, engine.NewAppError("INTERNAL_ERROR", 500, "Failed to generate access token")
	}

	refreshToken := GenerateRefreshToken()
	expiresAt := time.Now().Add(RefreshTokenTTL)

	_, err = store.Exec(ctx, h.store.Pool,
		`INSERT INTO _refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
		userID, refreshToken, expiresAt)
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
	default:
		return []string{}
	}
}
