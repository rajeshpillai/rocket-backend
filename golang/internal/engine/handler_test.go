package engine

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"

	"rocket-backend/internal/metadata"
)

// TestResolveEntity_UnknownEntityReturnsError verifies that resolveEntity returns
// a non-nil error when the entity doesn't exist in the registry. This prevents a
// nil-pointer dereference in callers that check `if err != nil` before using entity.
//
// Bug history: resolveEntity previously called respondError() which writes the HTTP
// response and returns nil. Callers checked `if err != nil` — but err was nil even
// when entity was nil, causing a panic on `entity.Name`.
//
// When refactoring Express.js/Elixir backends, ensure the same pattern is tested:
//   - Express: asyncHandler + throw pattern (already safe)
//   - Elixir: with {:ok, entity} <- resolve_entity(...) pattern (already safe)
func TestResolveEntity_UnknownEntityReturnsError(t *testing.T) {
	reg := metadata.NewRegistry()
	// Load a single entity so registry is non-empty but "nonexistent" won't be found
	reg.Load([]*metadata.Entity{
		{Name: "customer", Table: "customer", PrimaryKey: metadata.PrimaryKey{Field: "id", Generated: true}},
	}, nil)

	h := NewHandler(nil, reg)

	app := fiber.New()
	app.Get("/api/:entity", func(c *fiber.Ctx) error {
		entity, err := h.resolveEntity(c)
		if err != nil {
			// This is the correct path — error must be non-nil
			var appErr *AppError
			if !isAppError(err, &appErr) {
				t.Fatalf("expected *AppError, got %T: %v", err, err)
			}
			if appErr.Code != "UNKNOWN_ENTITY" {
				t.Fatalf("expected code UNKNOWN_ENTITY, got %s", appErr.Code)
			}
			return c.Status(appErr.Status).JSON(ErrorResponse{Error: appErr})
		}
		// If we reach here with nil entity, that's the bug
		if entity == nil {
			t.Fatal("BUG: resolveEntity returned (nil, nil) — entity is nil but err is also nil")
		}
		return c.JSON(fiber.Map{"name": entity.Name})
	})

	// Test 1: Unknown entity should return error, not panic
	req, _ := http.NewRequest("GET", "/api/nonexistent", nil)
	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != 404 {
		t.Fatalf("expected 404 for unknown entity, got %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	var errResp ErrorResponse
	if err := json.Unmarshal(body, &errResp); err != nil {
		t.Fatalf("failed to parse error response: %v", err)
	}
	if errResp.Error.Code != "UNKNOWN_ENTITY" {
		t.Fatalf("expected UNKNOWN_ENTITY code, got %s", errResp.Error.Code)
	}
	if !strings.Contains(errResp.Error.Message, "nonexistent") {
		t.Fatalf("expected message to contain entity name, got: %s", errResp.Error.Message)
	}

	// Test 2: Known entity should return successfully
	req2, _ := http.NewRequest("GET", "/api/customer", nil)
	resp2, err := app.Test(req2, -1)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp2.StatusCode != 200 {
		t.Fatalf("expected 200 for known entity, got %d", resp2.StatusCode)
	}
}

// isAppError is a test helper (errors.As wrapper).
func isAppError(err error, target **AppError) bool {
	return err != nil && (func() bool {
		var ae *AppError
		switch e := err.(type) {
		case *AppError:
			ae = e
		default:
			return false
		}
		*target = ae
		return true
	})()
}
