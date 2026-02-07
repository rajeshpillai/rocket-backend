//go:build integration

package engine_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"testing"

	"github.com/gofiber/fiber/v2"

	"rocket-backend/internal/admin"
	"rocket-backend/internal/auth"
	"rocket-backend/internal/config"
	"rocket-backend/internal/engine"
	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

func testStore(t *testing.T) *store.Store {
	t.Helper()
	ctx := context.Background()
	s, err := store.New(ctx, config.DatabaseConfig{
		Host:     "localhost",
		Port:     5433,
		User:     "rocket",
		Password: "rocket",
		Name:     "rocket",
		PoolSize: 2,
	})
	if err != nil {
		t.Fatalf("connect to test db: %v", err)
	}
	if err := s.Bootstrap(ctx); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	return s
}

func testApp(t *testing.T, s *store.Store, reg *metadata.Registry) *fiber.App {
	t.Helper()
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			var appErr *engine.AppError
			if errors.As(err, &appErr) {
				return c.Status(appErr.Status).JSON(engine.ErrorResponse{Error: appErr})
			}
			log.Printf("ERROR: %v", err)
			return c.Status(500).JSON(engine.ErrorResponse{
				Error: &engine.AppError{Code: "INTERNAL_ERROR", Message: "Internal server error"},
			})
		},
	})
	// Inject admin user for all requests (non-auth tests don't test auth)
	fakeAdmin := func(c *fiber.Ctx) error {
		c.Locals("user", &metadata.UserContext{ID: "test-admin", Roles: []string{"admin"}})
		return c.Next()
	}
	migrator := store.NewMigrator(s)
	adminH := admin.NewHandler(s, reg, migrator)
	admin.RegisterAdminRoutes(app, adminH, fakeAdmin)
	wfH := engine.NewWorkflowHandler(s, reg)
	engine.RegisterWorkflowRoutes(app, wfH, fakeAdmin)
	engineH := engine.NewHandler(s, reg)
	engine.RegisterDynamicRoutes(app, engineH, fakeAdmin)
	return app
}

const testJWTSecret = "test-secret"

func testAppWithAuth(t *testing.T, s *store.Store, reg *metadata.Registry) *fiber.App {
	t.Helper()
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			var appErr *engine.AppError
			if errors.As(err, &appErr) {
				return c.Status(appErr.Status).JSON(engine.ErrorResponse{Error: appErr})
			}
			log.Printf("ERROR: %v", err)
			return c.Status(500).JSON(engine.ErrorResponse{
				Error: &engine.AppError{Code: "INTERNAL_ERROR", Message: "Internal server error"},
			})
		},
	})

	// Auth routes — no middleware
	authHandler := auth.NewAuthHandler(s, testJWTSecret)
	auth.RegisterAuthRoutes(app, authHandler)

	authMW := auth.AuthMiddleware(testJWTSecret)
	adminMW := auth.RequireAdmin()

	migrator := store.NewMigrator(s)
	adminH := admin.NewHandler(s, reg, migrator)
	admin.RegisterAdminRoutes(app, adminH, authMW, adminMW)

	wfH := engine.NewWorkflowHandler(s, reg)
	engine.RegisterWorkflowRoutes(app, wfH, authMW)

	engineH := engine.NewHandler(s, reg)
	engine.RegisterDynamicRoutes(app, engineH, authMW)

	return app
}

func doAuthRequest(t *testing.T, app *fiber.App, method, path, token string, body any) *http.Response {
	t.Helper()
	var reader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, path, reader)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatalf("execute request: %v", err)
	}
	return resp
}

func loginAs(t *testing.T, app *fiber.App, email, password string) string {
	t.Helper()
	resp := doRequest(t, app, "POST", "/api/auth/login", map[string]any{
		"email":    email,
		"password": password,
	})
	if resp.StatusCode != 200 {
		t.Fatalf("login as %s: expected 200, got %d: %s", email, resp.StatusCode, readBody(t, resp))
	}
	var result map[string]any
	json.Unmarshal(readBody(t, resp), &result)
	data := result["data"].(map[string]any)
	return data["access_token"].(string)
}

func loginAsWithRefresh(t *testing.T, app *fiber.App, email, password string) (string, string) {
	t.Helper()
	resp := doRequest(t, app, "POST", "/api/auth/login", map[string]any{
		"email":    email,
		"password": password,
	})
	if resp.StatusCode != 200 {
		t.Fatalf("login as %s: expected 200, got %d: %s", email, resp.StatusCode, readBody(t, resp))
	}
	var result map[string]any
	json.Unmarshal(readBody(t, resp), &result)
	data := result["data"].(map[string]any)
	return data["access_token"].(string), data["refresh_token"].(string)
}

func createTestUser(t *testing.T, app *fiber.App, token, email, password string, roles []string) string {
	t.Helper()
	resp := doAuthRequest(t, app, "POST", "/api/_admin/users", token, map[string]any{
		"email":    email,
		"password": password,
		"roles":    roles,
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create user %s: expected 201, got %d: %s", email, resp.StatusCode, readBody(t, resp))
	}
	var result map[string]any
	json.Unmarshal(readBody(t, resp), &result)
	return result["data"].(map[string]any)["id"].(string)
}

func doRequest(t *testing.T, app *fiber.App, method, path string, body any) *http.Response {
	t.Helper()
	var reader io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, path, reader)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatalf("execute request: %v", err)
	}
	return resp
}

func readBody(t *testing.T, resp *http.Response) []byte {
	t.Helper()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return b
}

func TestCreateDuplicate_Returns409(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testApp(t, s, reg)

	const entityName = "_test_unique_users"

	// Cleanup at end (runs even if test fails)
	defer func() {
		store.Exec(ctx, s.Pool, "DROP TABLE IF EXISTS "+entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _entities WHERE name = $1", entityName)
		_ = metadata.Reload(ctx, s.Pool, reg)
	}()

	// 1. Create entity with unique email field
	entityDef := map[string]any{
		"name":  entityName,
		"table": entityName,
		"primary_key": map[string]any{
			"field": "id", "type": "uuid", "generated": true,
		},
		"fields": []any{
			map[string]any{"name": "id", "type": "uuid"},
			map[string]any{"name": "email", "type": "string", "required": true, "unique": true},
			map[string]any{"name": "name", "type": "string", "required": true},
		},
	}
	resp := doRequest(t, app, "POST", "/api/_admin/entities", entityDef)
	if resp.StatusCode != 201 {
		t.Fatalf("create entity: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 2. Insert first record — should succeed
	resp = doRequest(t, app, "POST", "/api/"+entityName, map[string]any{
		"email": "dup@test.com",
		"name":  "Alice",
	})
	if resp.StatusCode != 201 {
		t.Fatalf("insert first record: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 3. Insert duplicate — should return 409 CONFLICT
	resp = doRequest(t, app, "POST", "/api/"+entityName, map[string]any{
		"email": "dup@test.com",
		"name":  "Bob",
	})
	body := readBody(t, resp)

	if resp.StatusCode != 409 {
		t.Fatalf("insert duplicate: expected 409, got %d: %s", resp.StatusCode, body)
	}

	var errResp engine.ErrorResponse
	if err := json.Unmarshal(body, &errResp); err != nil {
		t.Fatalf("parse error response: %v", err)
	}
	if errResp.Error.Code != "CONFLICT" {
		t.Fatalf("expected error code CONFLICT, got %s", errResp.Error.Code)
	}
}

func TestFieldRuleEnforcement(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testApp(t, s, reg)

	const entityName = "_test_field_rule_entity"

	// Cleanup
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _rules WHERE entity = $1", entityName)
		store.Exec(ctx, s.Pool, "DROP TABLE IF EXISTS "+entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _entities WHERE name = $1", entityName)
		_ = metadata.Reload(ctx, s.Pool, reg)
	}()

	// 1. Create entity
	resp := doRequest(t, app, "POST", "/api/_admin/entities", map[string]any{
		"name": entityName, "table": entityName,
		"primary_key": map[string]any{"field": "id", "type": "uuid", "generated": true},
		"fields": []any{
			map[string]any{"name": "id", "type": "uuid"},
			map[string]any{"name": "total", "type": "decimal", "precision": 2},
			map[string]any{"name": "name", "type": "string", "required": true},
		},
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create entity: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 2. Add field rule: total >= 0
	resp = doRequest(t, app, "POST", "/api/_admin/rules", map[string]any{
		"entity": entityName,
		"hook":   "before_write",
		"type":   "field",
		"definition": map[string]any{
			"field":    "total",
			"operator": "min",
			"value":    0,
			"message":  "Total must be non-negative",
		},
		"priority": 10,
		"active":   true,
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create rule: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 3. Insert record with total=-1 — should return 422
	resp = doRequest(t, app, "POST", "/api/"+entityName, map[string]any{
		"total": -1,
		"name":  "Bad Record",
	})
	body := readBody(t, resp)
	if resp.StatusCode != 422 {
		t.Fatalf("insert with total=-1: expected 422, got %d: %s", resp.StatusCode, body)
	}

	var errResp engine.ErrorResponse
	if err := json.Unmarshal(body, &errResp); err != nil {
		t.Fatalf("parse error response: %v", err)
	}
	if errResp.Error.Code != "VALIDATION_FAILED" {
		t.Fatalf("expected VALIDATION_FAILED, got %s", errResp.Error.Code)
	}
	if len(errResp.Error.Details) == 0 {
		t.Fatal("expected error details with field rule violation")
	}
	if errResp.Error.Details[0].Field != "total" {
		t.Fatalf("expected field=total, got %s", errResp.Error.Details[0].Field)
	}

	// 4. Insert record with total=100 — should succeed
	resp = doRequest(t, app, "POST", "/api/"+entityName, map[string]any{
		"total": 100,
		"name":  "Good Record",
	})
	if resp.StatusCode != 201 {
		t.Fatalf("insert with total=100: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}
}

func TestComputedFieldEnforcement(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testApp(t, s, reg)

	const entityName = "_test_computed_entity"

	// Cleanup
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _rules WHERE entity = $1", entityName)
		store.Exec(ctx, s.Pool, "DROP TABLE IF EXISTS "+entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _entities WHERE name = $1", entityName)
		_ = metadata.Reload(ctx, s.Pool, reg)
	}()

	// 1. Create entity with subtotal, tax_rate, total
	resp := doRequest(t, app, "POST", "/api/_admin/entities", map[string]any{
		"name": entityName, "table": entityName,
		"primary_key": map[string]any{"field": "id", "type": "uuid", "generated": true},
		"fields": []any{
			map[string]any{"name": "id", "type": "uuid"},
			map[string]any{"name": "subtotal", "type": "decimal", "precision": 2},
			map[string]any{"name": "tax_rate", "type": "decimal", "precision": 4},
			map[string]any{"name": "total", "type": "decimal", "precision": 2},
			map[string]any{"name": "name", "type": "string", "required": true},
		},
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create entity: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 2. Add computed rule: total = subtotal * (1 + tax_rate)
	resp = doRequest(t, app, "POST", "/api/_admin/rules", map[string]any{
		"entity": entityName,
		"hook":   "before_write",
		"type":   "computed",
		"definition": map[string]any{
			"field":      "total",
			"expression": "record.subtotal * (1 + record.tax_rate)",
		},
		"priority": 100,
		"active":   true,
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create computed rule: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 3. Insert record without total — computed should fill it
	resp = doRequest(t, app, "POST", "/api/"+entityName, map[string]any{
		"subtotal": 100,
		"tax_rate": 0.1,
		"name":     "Computed Test",
	})
	body := readBody(t, resp)
	if resp.StatusCode != 201 {
		t.Fatalf("insert: expected 201, got %d: %s", resp.StatusCode, body)
	}

	var createResp map[string]any
	json.Unmarshal(body, &createResp)
	data := createResp["data"].(map[string]any)

	// Check total was computed
	total, ok := data["total"]
	if !ok || total == nil {
		t.Fatal("expected total to be computed")
	}
}

func TestStateMachineEnforcement(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testApp(t, s, reg)

	const entityName = "_test_sm_entity"

	// Cleanup
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _state_machines WHERE entity = $1", entityName)
		store.Exec(ctx, s.Pool, "DROP TABLE IF EXISTS "+entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _entities WHERE name = $1", entityName)
		_ = metadata.Reload(ctx, s.Pool, reg)
	}()

	// 1. Create entity with status and total fields
	resp := doRequest(t, app, "POST", "/api/_admin/entities", map[string]any{
		"name": entityName, "table": entityName,
		"primary_key": map[string]any{"field": "id", "type": "uuid", "generated": true},
		"fields": []any{
			map[string]any{"name": "id", "type": "uuid"},
			map[string]any{"name": "status", "type": "string"},
			map[string]any{"name": "total", "type": "decimal", "precision": 2},
			map[string]any{"name": "sent_at", "type": "string"},
			map[string]any{"name": "name", "type": "string", "required": true},
		},
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create entity: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 2. Create state machine: draft → sent (guard: total > 0, action: set sent_at = now)
	resp = doRequest(t, app, "POST", "/api/_admin/state-machines", map[string]any{
		"entity": entityName,
		"field":  "status",
		"definition": map[string]any{
			"initial": "draft",
			"transitions": []any{
				map[string]any{
					"from":  "draft",
					"to":    "sent",
					"guard": "record.total > 0",
					"actions": []any{
						map[string]any{"type": "set_field", "field": "sent_at", "value": "now"},
					},
				},
				map[string]any{
					"from": "sent",
					"to":   "paid",
				},
			},
		},
		"active": true,
	})
	body := readBody(t, resp)
	if resp.StatusCode != 201 {
		t.Fatalf("create state machine: expected 201, got %d: %s", resp.StatusCode, body)
	}

	// 3. POST record with status=draft → 201
	resp = doRequest(t, app, "POST", "/api/"+entityName, map[string]any{
		"status": "draft",
		"total":  100,
		"name":   "Invoice 1",
	})
	body = readBody(t, resp)
	if resp.StatusCode != 201 {
		t.Fatalf("create with status=draft: expected 201, got %d: %s", resp.StatusCode, body)
	}

	var createResp map[string]any
	json.Unmarshal(body, &createResp)
	data := createResp["data"].(map[string]any)
	recordID := data["id"].(string)

	// 4. PUT record with status=sent, total=100 → 200 (sent_at populated)
	resp = doRequest(t, app, "PUT", "/api/"+entityName+"/"+recordID, map[string]any{
		"status": "sent",
		"total":  100,
	})
	body = readBody(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("transition draft→sent: expected 200, got %d: %s", resp.StatusCode, body)
	}

	var updateResp map[string]any
	json.Unmarshal(body, &updateResp)
	updatedData := updateResp["data"].(map[string]any)
	sentAt, ok := updatedData["sent_at"]
	if !ok || sentAt == nil || sentAt == "" {
		t.Fatal("expected sent_at to be populated by set_field action")
	}

	// 5. PUT record with status=paid from sent → 200 (valid transition, no guard)
	resp = doRequest(t, app, "PUT", "/api/"+entityName+"/"+recordID, map[string]any{
		"status": "paid",
	})
	if resp.StatusCode != 200 {
		t.Fatalf("transition sent→paid: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 6. Create another record to test guard failure and invalid transition
	resp = doRequest(t, app, "POST", "/api/"+entityName, map[string]any{
		"status": "draft",
		"total":  0,
		"name":   "Invoice 2",
	})
	body = readBody(t, resp)
	if resp.StatusCode != 201 {
		t.Fatalf("create second record: expected 201, got %d: %s", resp.StatusCode, body)
	}

	json.Unmarshal(body, &createResp)
	data = createResp["data"].(map[string]any)
	record2ID := data["id"].(string)

	// 7. PUT with status=sent, total=0 → 422 (guard: total > 0 fails)
	resp = doRequest(t, app, "PUT", "/api/"+entityName+"/"+record2ID, map[string]any{
		"status": "sent",
		"total":  0,
	})
	body = readBody(t, resp)
	if resp.StatusCode != 422 {
		t.Fatalf("guard fail: expected 422, got %d: %s", resp.StatusCode, body)
	}

	var errResp engine.ErrorResponse
	json.Unmarshal(body, &errResp)
	if errResp.Error.Code != "VALIDATION_FAILED" {
		t.Fatalf("expected VALIDATION_FAILED, got %s", errResp.Error.Code)
	}

	// 8. PUT with status=paid (direct draft→paid) → 422 (invalid transition)
	resp = doRequest(t, app, "PUT", "/api/"+entityName+"/"+record2ID, map[string]any{
		"status": "paid",
	})
	body = readBody(t, resp)
	if resp.StatusCode != 422 {
		t.Fatalf("invalid transition: expected 422, got %d: %s", resp.StatusCode, body)
	}
	json.Unmarshal(body, &errResp)
	if errResp.Error.Code != "VALIDATION_FAILED" {
		t.Fatalf("expected VALIDATION_FAILED, got %s", errResp.Error.Code)
	}

	// 9. POST with invalid initial state → 422
	resp = doRequest(t, app, "POST", "/api/"+entityName, map[string]any{
		"status": "sent",
		"total":  50,
		"name":   "Invoice Bad",
	})
	body = readBody(t, resp)
	if resp.StatusCode != 422 {
		t.Fatalf("invalid initial state: expected 422, got %d: %s", resp.StatusCode, body)
	}
}

func TestStateMachineCRUD(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testApp(t, s, reg)

	const entityName = "_test_sm_crud_entity"

	// Cleanup
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _state_machines WHERE entity = $1", entityName)
		store.Exec(ctx, s.Pool, "DROP TABLE IF EXISTS "+entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _entities WHERE name = $1", entityName)
		_ = metadata.Reload(ctx, s.Pool, reg)
	}()

	// Create test entity
	resp := doRequest(t, app, "POST", "/api/_admin/entities", map[string]any{
		"name": entityName, "table": entityName,
		"primary_key": map[string]any{"field": "id", "type": "uuid", "generated": true},
		"fields": []any{
			map[string]any{"name": "id", "type": "uuid"},
			map[string]any{"name": "status", "type": "string"},
			map[string]any{"name": "name", "type": "string", "required": true},
		},
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create entity: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 1. Create state machine
	smDef := map[string]any{
		"entity": entityName,
		"field":  "status",
		"definition": map[string]any{
			"initial": "new",
			"transitions": []any{
				map[string]any{"from": "new", "to": "active"},
			},
		},
		"active": true,
	}
	resp = doRequest(t, app, "POST", "/api/_admin/state-machines", smDef)
	body := readBody(t, resp)
	if resp.StatusCode != 201 {
		t.Fatalf("create sm: expected 201, got %d: %s", resp.StatusCode, body)
	}

	var createResp map[string]any
	json.Unmarshal(body, &createResp)
	data := createResp["data"].(map[string]any)
	smID := data["id"].(string)
	if smID == "" {
		t.Fatal("expected state machine ID in response")
	}

	// 2. List state machines
	resp = doRequest(t, app, "GET", "/api/_admin/state-machines", nil)
	if resp.StatusCode != 200 {
		t.Fatalf("list sms: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 3. Get state machine by ID
	resp = doRequest(t, app, "GET", "/api/_admin/state-machines/"+smID, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("get sm: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 4. Update state machine
	resp = doRequest(t, app, "PUT", "/api/_admin/state-machines/"+smID, map[string]any{
		"entity": entityName,
		"field":  "status",
		"definition": map[string]any{
			"initial": "new",
			"transitions": []any{
				map[string]any{"from": "new", "to": "active"},
				map[string]any{"from": "active", "to": "closed"},
			},
		},
		"active": true,
	})
	if resp.StatusCode != 200 {
		t.Fatalf("update sm: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 5. Delete state machine
	resp = doRequest(t, app, "DELETE", "/api/_admin/state-machines/"+smID, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("delete sm: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 6. Verify deleted
	resp = doRequest(t, app, "GET", "/api/_admin/state-machines/"+smID, nil)
	if resp.StatusCode != 404 {
		t.Fatalf("get deleted sm: expected 404, got %d: %s", resp.StatusCode, readBody(t, resp))
	}
}

func TestRulesCRUD(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testApp(t, s, reg)

	const entityName = "_test_rules_entity"

	// Cleanup
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _rules WHERE entity = $1", entityName)
		store.Exec(ctx, s.Pool, "DROP TABLE IF EXISTS "+entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _entities WHERE name = $1", entityName)
		_ = metadata.Reload(ctx, s.Pool, reg)
	}()

	// Create test entity
	resp := doRequest(t, app, "POST", "/api/_admin/entities", map[string]any{
		"name": entityName, "table": entityName,
		"primary_key": map[string]any{"field": "id", "type": "uuid", "generated": true},
		"fields": []any{
			map[string]any{"name": "id", "type": "uuid"},
			map[string]any{"name": "total", "type": "decimal", "precision": 2},
			map[string]any{"name": "name", "type": "string", "required": true},
		},
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create entity: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 1. Create a field rule
	ruleDef := map[string]any{
		"entity": entityName,
		"hook":   "before_write",
		"type":   "field",
		"definition": map[string]any{
			"field":    "total",
			"operator": "min",
			"value":    0,
			"message":  "Total must be non-negative",
		},
		"priority": 10,
	}
	resp = doRequest(t, app, "POST", "/api/_admin/rules", ruleDef)
	body := readBody(t, resp)
	if resp.StatusCode != 201 {
		t.Fatalf("create rule: expected 201, got %d: %s", resp.StatusCode, body)
	}

	// Extract rule ID from response
	var createResp map[string]any
	json.Unmarshal(body, &createResp)
	data := createResp["data"].(map[string]any)
	ruleID := data["id"].(string)
	if ruleID == "" {
		t.Fatal("expected rule ID in response")
	}

	// 2. List rules
	resp = doRequest(t, app, "GET", "/api/_admin/rules", nil)
	if resp.StatusCode != 200 {
		t.Fatalf("list rules: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 3. Get rule by ID
	resp = doRequest(t, app, "GET", "/api/_admin/rules/"+ruleID, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("get rule: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 4. Update rule
	resp = doRequest(t, app, "PUT", "/api/_admin/rules/"+ruleID, map[string]any{
		"entity": entityName,
		"hook":   "before_write",
		"type":   "field",
		"definition": map[string]any{
			"field":    "total",
			"operator": "min",
			"value":    -100,
			"message":  "Total must be at least -100",
		},
		"priority": 20,
	})
	if resp.StatusCode != 200 {
		t.Fatalf("update rule: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 5. Delete rule
	resp = doRequest(t, app, "DELETE", "/api/_admin/rules/"+ruleID, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("delete rule: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 6. Verify deleted
	resp = doRequest(t, app, "GET", "/api/_admin/rules/"+ruleID, nil)
	if resp.StatusCode != 404 {
		t.Fatalf("get deleted rule: expected 404, got %d: %s", resp.StatusCode, readBody(t, resp))
	}
}

func TestWorkflowCRUD(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testApp(t, s, reg)

	// Cleanup
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _workflow_instances")
		store.Exec(ctx, s.Pool, "DELETE FROM _workflows")
		_ = metadata.Reload(ctx, s.Pool, reg)
	}()

	// 1. Create workflow
	wfDef := map[string]any{
		"name": "test_wf_crud",
		"trigger": map[string]any{
			"type": "state_change", "entity": "order", "field": "status", "to": "pending",
		},
		"context": map[string]any{"id": "trigger.record_id"},
		"steps": []any{
			map[string]any{
				"id": "auto_approve", "type": "action",
				"actions": []any{},
				"then":    "end",
			},
		},
		"active": true,
	}
	resp := doRequest(t, app, "POST", "/api/_admin/workflows", wfDef)
	body := readBody(t, resp)
	if resp.StatusCode != 201 {
		t.Fatalf("create workflow: expected 201, got %d: %s", resp.StatusCode, body)
	}

	var createResp map[string]any
	json.Unmarshal(body, &createResp)
	data := createResp["data"].(map[string]any)
	wfID := data["id"].(string)
	if wfID == "" {
		t.Fatal("expected workflow ID")
	}

	// 2. List workflows
	resp = doRequest(t, app, "GET", "/api/_admin/workflows", nil)
	if resp.StatusCode != 200 {
		t.Fatalf("list workflows: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 3. Get workflow by ID
	resp = doRequest(t, app, "GET", "/api/_admin/workflows/"+wfID, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("get workflow: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 4. Update workflow
	resp = doRequest(t, app, "PUT", "/api/_admin/workflows/"+wfID, map[string]any{
		"name": "test_wf_crud",
		"trigger": map[string]any{
			"type": "state_change", "entity": "order", "field": "status", "to": "approved",
		},
		"context": map[string]any{"id": "trigger.record_id"},
		"steps": []any{
			map[string]any{
				"id": "auto_approve", "type": "action",
				"actions": []any{},
				"then":    "end",
			},
		},
		"active": true,
	})
	if resp.StatusCode != 200 {
		t.Fatalf("update workflow: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 5. Delete workflow
	resp = doRequest(t, app, "DELETE", "/api/_admin/workflows/"+wfID, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("delete workflow: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 6. Verify deleted
	resp = doRequest(t, app, "GET", "/api/_admin/workflows/"+wfID, nil)
	if resp.StatusCode != 404 {
		t.Fatalf("get deleted workflow: expected 404, got %d: %s", resp.StatusCode, readBody(t, resp))
	}
}

func TestWorkflowTriggerAndExecution(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testApp(t, s, reg)

	const entityName = "_test_wf_trigger"

	// Cleanup
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _workflow_instances")
		store.Exec(ctx, s.Pool, "DELETE FROM _workflows")
		store.Exec(ctx, s.Pool, "DELETE FROM _state_machines WHERE entity = $1", entityName)
		store.Exec(ctx, s.Pool, "DROP TABLE IF EXISTS "+entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _entities WHERE name = $1", entityName)
		_ = metadata.Reload(ctx, s.Pool, reg)
	}()

	// 1. Create entity with status and reviewed fields
	resp := doRequest(t, app, "POST", "/api/_admin/entities", map[string]any{
		"name": entityName, "table": entityName,
		"primary_key": map[string]any{"field": "id", "type": "uuid", "generated": true},
		"fields": []any{
			map[string]any{"name": "id", "type": "uuid"},
			map[string]any{"name": "status", "type": "string"},
			map[string]any{"name": "total", "type": "decimal", "precision": 2},
			map[string]any{"name": "reviewed", "type": "boolean"},
			map[string]any{"name": "name", "type": "string", "required": true},
		},
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create entity: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 2. Create state machine: draft → pending_approval
	resp = doRequest(t, app, "POST", "/api/_admin/state-machines", map[string]any{
		"entity": entityName, "field": "status",
		"definition": map[string]any{
			"initial": "draft",
			"transitions": []any{
				map[string]any{"from": "draft", "to": "pending_approval"},
			},
		},
		"active": true,
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create sm: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 3. Create workflow: on status→pending_approval, set reviewed=true
	resp = doRequest(t, app, "POST", "/api/_admin/workflows", map[string]any{
		"name": "test_auto_review",
		"trigger": map[string]any{
			"type": "state_change", "entity": entityName, "field": "status", "to": "pending_approval",
		},
		"context": map[string]any{
			"record_id": "trigger.record_id",
		},
		"steps": []any{
			map[string]any{
				"id": "set_reviewed", "type": "action",
				"actions": []any{
					map[string]any{
						"type": "set_field", "entity": entityName,
						"record_id": "context.record_id", "field": "reviewed", "value": true,
					},
				},
				"then": "end",
			},
		},
		"active": true,
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create workflow: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 4. Create record with status=draft
	resp = doRequest(t, app, "POST", "/api/"+entityName, map[string]any{
		"status": "draft", "total": 100, "name": "PO 1",
	})
	body := readBody(t, resp)
	if resp.StatusCode != 201 {
		t.Fatalf("create record: expected 201, got %d: %s", resp.StatusCode, body)
	}

	var createResp map[string]any
	json.Unmarshal(body, &createResp)
	recordID := createResp["data"].(map[string]any)["id"].(string)

	// 5. Transition to pending_approval → should trigger workflow
	resp = doRequest(t, app, "PUT", "/api/"+entityName+"/"+recordID, map[string]any{
		"status": "pending_approval",
	})
	body = readBody(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("transition: expected 200, got %d: %s", resp.StatusCode, body)
	}

	// 6. Verify reviewed was set to true by workflow
	resp = doRequest(t, app, "GET", "/api/"+entityName+"/"+recordID, nil)
	body = readBody(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("get record: expected 200, got %d: %s", resp.StatusCode, body)
	}

	var getResp map[string]any
	json.Unmarshal(body, &getResp)
	reviewed := getResp["data"].(map[string]any)["reviewed"]
	if reviewed != true {
		t.Fatalf("expected reviewed=true, got %v", reviewed)
	}

	// 7. Verify workflow instance was created and completed
	resp = doRequest(t, app, "GET", "/api/_workflows/pending", nil)
	body = readBody(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("list pending: expected 200, got %d: %s", resp.StatusCode, body)
	}
}

func TestWorkflowApprovalFlow(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testApp(t, s, reg)

	const entityName = "_test_wf_approval"

	// Cleanup
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _workflow_instances")
		store.Exec(ctx, s.Pool, "DELETE FROM _workflows")
		store.Exec(ctx, s.Pool, "DELETE FROM _state_machines WHERE entity = $1", entityName)
		store.Exec(ctx, s.Pool, "DROP TABLE IF EXISTS "+entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _entities WHERE name = $1", entityName)
		_ = metadata.Reload(ctx, s.Pool, reg)
	}()

	// 1. Create entity
	resp := doRequest(t, app, "POST", "/api/_admin/entities", map[string]any{
		"name": entityName, "table": entityName,
		"primary_key": map[string]any{"field": "id", "type": "uuid", "generated": true},
		"fields": []any{
			map[string]any{"name": "id", "type": "uuid"},
			map[string]any{"name": "status", "type": "string"},
			map[string]any{"name": "total", "type": "decimal", "precision": 2},
			map[string]any{"name": "name", "type": "string", "required": true},
		},
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create entity: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 2. Create state machine: draft → pending
	resp = doRequest(t, app, "POST", "/api/_admin/state-machines", map[string]any{
		"entity": entityName, "field": "status",
		"definition": map[string]any{
			"initial": "draft",
			"transitions": []any{
				map[string]any{"from": "draft", "to": "pending"},
				map[string]any{"from": "pending", "to": "approved"},
				map[string]any{"from": "pending", "to": "rejected"},
			},
		},
		"active": true,
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create sm: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 3. Create workflow: approval step → on approve: set status=approved → end
	resp = doRequest(t, app, "POST", "/api/_admin/workflows", map[string]any{
		"name": "test_approval",
		"trigger": map[string]any{
			"type": "state_change", "entity": entityName, "field": "status", "to": "pending",
		},
		"context": map[string]any{
			"record_id": "trigger.record_id",
		},
		"steps": []any{
			map[string]any{
				"id": "mgr_approval", "type": "approval",
				"assignee":   map[string]any{"type": "role", "role": "manager"},
				"timeout":    "72h",
				"on_approve": map[string]any{"goto": "do_approve"},
				"on_reject":  map[string]any{"goto": "do_reject"},
			},
			map[string]any{
				"id": "do_approve", "type": "action",
				"actions": []any{
					map[string]any{
						"type": "set_field", "entity": entityName,
						"record_id": "context.record_id", "field": "status", "value": "approved",
					},
				},
				"then": "end",
			},
			map[string]any{
				"id": "do_reject", "type": "action",
				"actions": []any{
					map[string]any{
						"type": "set_field", "entity": entityName,
						"record_id": "context.record_id", "field": "status", "value": "rejected",
					},
				},
				"then": "end",
			},
		},
		"active": true,
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create workflow: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 4. Create record and transition to pending
	resp = doRequest(t, app, "POST", "/api/"+entityName, map[string]any{
		"status": "draft", "total": 100, "name": "PO 1",
	})
	body := readBody(t, resp)
	if resp.StatusCode != 201 {
		t.Fatalf("create record: expected 201, got %d: %s", resp.StatusCode, body)
	}
	var createResp map[string]any
	json.Unmarshal(body, &createResp)
	recordID := createResp["data"].(map[string]any)["id"].(string)

	resp = doRequest(t, app, "PUT", "/api/"+entityName+"/"+recordID, map[string]any{
		"status": "pending",
	})
	if resp.StatusCode != 200 {
		t.Fatalf("transition to pending: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 5. Verify workflow is paused at approval step
	resp = doRequest(t, app, "GET", "/api/_workflows/pending", nil)
	body = readBody(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("list pending: expected 200, got %d: %s", resp.StatusCode, body)
	}

	var pendingResp map[string]any
	json.Unmarshal(body, &pendingResp)
	pendingData := pendingResp["data"].([]any)
	if len(pendingData) == 0 {
		t.Fatal("expected at least 1 pending workflow instance")
	}

	instanceID := pendingData[0].(map[string]any)["id"].(string)
	currentStep := pendingData[0].(map[string]any)["current_step"].(string)
	if currentStep != "mgr_approval" {
		t.Fatalf("expected current_step=mgr_approval, got %s", currentStep)
	}

	// 6. Get instance details
	resp = doRequest(t, app, "GET", "/api/_workflows/"+instanceID, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("get instance: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 7. Approve
	resp = doRequest(t, app, "POST", "/api/_workflows/"+instanceID+"/approve", nil)
	body = readBody(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("approve: expected 200, got %d: %s", resp.StatusCode, body)
	}

	var approveResp map[string]any
	json.Unmarshal(body, &approveResp)
	instanceData := approveResp["data"].(map[string]any)
	if instanceData["status"].(string) != "completed" {
		t.Fatalf("expected status=completed, got %s", instanceData["status"])
	}

	// 8. Verify record status was set to "approved"
	resp = doRequest(t, app, "GET", "/api/"+entityName+"/"+recordID, nil)
	body = readBody(t, resp)
	var getResp map[string]any
	json.Unmarshal(body, &getResp)
	finalStatus := getResp["data"].(map[string]any)["status"].(string)
	if finalStatus != "approved" {
		t.Fatalf("expected record status=approved, got %s", finalStatus)
	}
}

func TestWorkflowRejection(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testApp(t, s, reg)

	const entityName = "_test_wf_reject"

	// Cleanup
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _workflow_instances")
		store.Exec(ctx, s.Pool, "DELETE FROM _workflows")
		store.Exec(ctx, s.Pool, "DELETE FROM _state_machines WHERE entity = $1", entityName)
		store.Exec(ctx, s.Pool, "DROP TABLE IF EXISTS "+entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _entities WHERE name = $1", entityName)
		_ = metadata.Reload(ctx, s.Pool, reg)
	}()

	// Create entity + state machine + workflow (same as approval test)
	resp := doRequest(t, app, "POST", "/api/_admin/entities", map[string]any{
		"name": entityName, "table": entityName,
		"primary_key": map[string]any{"field": "id", "type": "uuid", "generated": true},
		"fields": []any{
			map[string]any{"name": "id", "type": "uuid"},
			map[string]any{"name": "status", "type": "string"},
			map[string]any{"name": "name", "type": "string", "required": true},
		},
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create entity: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	doRequest(t, app, "POST", "/api/_admin/state-machines", map[string]any{
		"entity": entityName, "field": "status",
		"definition": map[string]any{
			"initial": "draft",
			"transitions": []any{
				map[string]any{"from": "draft", "to": "pending"},
				map[string]any{"from": "pending", "to": "rejected"},
			},
		},
		"active": true,
	})

	doRequest(t, app, "POST", "/api/_admin/workflows", map[string]any{
		"name": "test_rejection",
		"trigger": map[string]any{
			"type": "state_change", "entity": entityName, "field": "status", "to": "pending",
		},
		"context": map[string]any{"record_id": "trigger.record_id"},
		"steps": []any{
			map[string]any{
				"id": "review", "type": "approval",
				"on_approve": map[string]any{"goto": "end"},
				"on_reject":  map[string]any{"goto": "do_reject"},
			},
			map[string]any{
				"id": "do_reject", "type": "action",
				"actions": []any{
					map[string]any{
						"type": "set_field", "entity": entityName,
						"record_id": "context.record_id", "field": "status", "value": "rejected",
					},
				},
				"then": "end",
			},
		},
		"active": true,
	})

	// Create and transition
	resp = doRequest(t, app, "POST", "/api/"+entityName, map[string]any{
		"status": "draft", "name": "PO Reject Test",
	})
	body := readBody(t, resp)
	var cr map[string]any
	json.Unmarshal(body, &cr)
	recordID := cr["data"].(map[string]any)["id"].(string)

	doRequest(t, app, "PUT", "/api/"+entityName+"/"+recordID, map[string]any{
		"status": "pending",
	})

	// Find pending instance
	resp = doRequest(t, app, "GET", "/api/_workflows/pending", nil)
	body = readBody(t, resp)
	var pr map[string]any
	json.Unmarshal(body, &pr)
	instances := pr["data"].([]any)
	if len(instances) == 0 {
		t.Fatal("expected pending instance")
	}
	instanceID := instances[0].(map[string]any)["id"].(string)

	// Reject
	resp = doRequest(t, app, "POST", "/api/_workflows/"+instanceID+"/reject", nil)
	body = readBody(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("reject: expected 200, got %d: %s", resp.StatusCode, body)
	}

	var rr map[string]any
	json.Unmarshal(body, &rr)
	if rr["data"].(map[string]any)["status"].(string) != "completed" {
		t.Fatal("expected completed after rejection")
	}

	// Verify record status was set to "rejected"
	resp = doRequest(t, app, "GET", "/api/"+entityName+"/"+recordID, nil)
	body = readBody(t, resp)
	var gr map[string]any
	json.Unmarshal(body, &gr)
	if gr["data"].(map[string]any)["status"].(string) != "rejected" {
		t.Fatal("expected record status=rejected")
	}
}

func TestWorkflowConditionBranching(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testApp(t, s, reg)

	const entityName = "_test_wf_cond"

	// Cleanup
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _workflow_instances")
		store.Exec(ctx, s.Pool, "DELETE FROM _workflows")
		store.Exec(ctx, s.Pool, "DELETE FROM _state_machines WHERE entity = $1", entityName)
		store.Exec(ctx, s.Pool, "DROP TABLE IF EXISTS "+entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _entities WHERE name = $1", entityName)
		_ = metadata.Reload(ctx, s.Pool, reg)
	}()

	// Create entity
	resp := doRequest(t, app, "POST", "/api/_admin/entities", map[string]any{
		"name": entityName, "table": entityName,
		"primary_key": map[string]any{"field": "id", "type": "uuid", "generated": true},
		"fields": []any{
			map[string]any{"name": "id", "type": "uuid"},
			map[string]any{"name": "status", "type": "string"},
			map[string]any{"name": "amount", "type": "decimal", "precision": 2},
			map[string]any{"name": "approved", "type": "boolean"},
			map[string]any{"name": "name", "type": "string", "required": true},
		},
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create entity: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// State machine: draft → review
	doRequest(t, app, "POST", "/api/_admin/state-machines", map[string]any{
		"entity": entityName, "field": "status",
		"definition": map[string]any{
			"initial": "draft",
			"transitions": []any{
				map[string]any{"from": "draft", "to": "review"},
			},
		},
		"active": true,
	})

	// Workflow: condition (amount > 10000) → true: approval step, false: auto-approve (set approved=true)
	doRequest(t, app, "POST", "/api/_admin/workflows", map[string]any{
		"name": "test_condition",
		"trigger": map[string]any{
			"type": "state_change", "entity": entityName, "field": "status", "to": "review",
		},
		"context": map[string]any{
			"record_id": "trigger.record_id",
			"amount":    "trigger.record.amount",
		},
		"steps": []any{
			map[string]any{
				"id": "check_amount", "type": "condition",
				"expression": "context.amount > 10000",
				"on_true":    map[string]any{"goto": "needs_approval"},
				"on_false":   map[string]any{"goto": "auto_approve"},
			},
			map[string]any{
				"id": "needs_approval", "type": "approval",
				"on_approve": map[string]any{"goto": "auto_approve"},
				"on_reject":  map[string]any{"goto": "end"},
			},
			map[string]any{
				"id": "auto_approve", "type": "action",
				"actions": []any{
					map[string]any{
						"type": "set_field", "entity": entityName,
						"record_id": "context.record_id", "field": "approved", "value": true,
					},
				},
				"then": "end",
			},
		},
		"active": true,
	})

	// Test 1: Small amount (5000) → should skip approval and auto-approve
	resp = doRequest(t, app, "POST", "/api/"+entityName, map[string]any{
		"status": "draft", "amount": 5000, "name": "Small PO",
	})
	body := readBody(t, resp)
	var cr map[string]any
	json.Unmarshal(body, &cr)
	smallID := cr["data"].(map[string]any)["id"].(string)

	resp = doRequest(t, app, "PUT", "/api/"+entityName+"/"+smallID, map[string]any{
		"status": "review",
	})
	if resp.StatusCode != 200 {
		t.Fatalf("small transition: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// Verify approved=true (auto-approved, no approval step)
	resp = doRequest(t, app, "GET", "/api/"+entityName+"/"+smallID, nil)
	body = readBody(t, resp)
	var gr map[string]any
	json.Unmarshal(body, &gr)
	if gr["data"].(map[string]any)["approved"] != true {
		t.Fatalf("expected approved=true for small amount, got %v", gr["data"].(map[string]any)["approved"])
	}

	// Test 2: Large amount (50000) → should pause at approval step
	resp = doRequest(t, app, "POST", "/api/"+entityName, map[string]any{
		"status": "draft", "amount": 50000, "name": "Big PO",
	})
	body = readBody(t, resp)
	json.Unmarshal(body, &cr)
	bigID := cr["data"].(map[string]any)["id"].(string)

	resp = doRequest(t, app, "PUT", "/api/"+entityName+"/"+bigID, map[string]any{
		"status": "review",
	})
	if resp.StatusCode != 200 {
		t.Fatalf("big transition: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// Verify paused at approval step
	resp = doRequest(t, app, "GET", "/api/_workflows/pending", nil)
	body = readBody(t, resp)
	var pr map[string]any
	json.Unmarshal(body, &pr)
	pending := pr["data"].([]any)

	found := false
	for _, p := range pending {
		inst := p.(map[string]any)
		if inst["current_step"].(string) == "needs_approval" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected a pending instance at needs_approval step")
	}
}

// ==================== Auth & Permissions Tests ====================

func TestAuthLoginRefreshLogout(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testAppWithAuth(t, s, reg)

	// Cleanup test users (keep seed admin)
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _refresh_tokens")
		store.Exec(ctx, s.Pool, "DELETE FROM _users WHERE email != 'admin@localhost'")
	}()

	// 1. Login with seed admin
	resp := doRequest(t, app, "POST", "/api/auth/login", map[string]any{
		"email":    "admin@localhost",
		"password": "changeme",
	})
	body := readBody(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("login: expected 200, got %d: %s", resp.StatusCode, body)
	}

	var loginResp map[string]any
	json.Unmarshal(body, &loginResp)
	data := loginResp["data"].(map[string]any)
	accessToken := data["access_token"].(string)
	refreshToken := data["refresh_token"].(string)
	if accessToken == "" || refreshToken == "" {
		t.Fatal("expected non-empty access_token and refresh_token")
	}

	// 2. Use access token to access protected endpoint
	resp = doAuthRequest(t, app, "GET", "/api/_admin/entities", accessToken, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("admin entities with token: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 3. Refresh token
	resp = doRequest(t, app, "POST", "/api/auth/refresh", map[string]any{
		"refresh_token": refreshToken,
	})
	body = readBody(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("refresh: expected 200, got %d: %s", resp.StatusCode, body)
	}

	var refreshResp map[string]any
	json.Unmarshal(body, &refreshResp)
	newData := refreshResp["data"].(map[string]any)
	newAccessToken := newData["access_token"].(string)
	newRefreshToken := newData["refresh_token"].(string)
	if newAccessToken == "" || newRefreshToken == "" {
		t.Fatal("expected non-empty tokens from refresh")
	}

	// 4. Old refresh token should be invalidated (rotation)
	resp = doRequest(t, app, "POST", "/api/auth/refresh", map[string]any{
		"refresh_token": refreshToken,
	})
	if resp.StatusCode != 401 {
		t.Fatalf("reuse old refresh token: expected 401, got %d", resp.StatusCode)
	}

	// 5. New access token works
	resp = doAuthRequest(t, app, "GET", "/api/_admin/entities", newAccessToken, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("admin with new token: expected 200, got %d", resp.StatusCode)
	}

	// 6. Logout
	resp = doRequest(t, app, "POST", "/api/auth/logout", map[string]any{
		"refresh_token": newRefreshToken,
	})
	if resp.StatusCode != 200 {
		t.Fatalf("logout: expected 200, got %d", resp.StatusCode)
	}

	// 7. Refresh with logged-out token fails
	resp = doRequest(t, app, "POST", "/api/auth/refresh", map[string]any{
		"refresh_token": newRefreshToken,
	})
	if resp.StatusCode != 401 {
		t.Fatalf("refresh after logout: expected 401, got %d", resp.StatusCode)
	}
}

func TestAuthLoginInvalidCredentials(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testAppWithAuth(t, s, reg)

	// 1. Wrong password
	resp := doRequest(t, app, "POST", "/api/auth/login", map[string]any{
		"email":    "admin@localhost",
		"password": "wrongpassword",
	})
	if resp.StatusCode != 401 {
		t.Fatalf("wrong password: expected 401, got %d", resp.StatusCode)
	}

	// 2. Non-existent email
	resp = doRequest(t, app, "POST", "/api/auth/login", map[string]any{
		"email":    "nobody@example.com",
		"password": "changeme",
	})
	if resp.StatusCode != 401 {
		t.Fatalf("non-existent email: expected 401, got %d", resp.StatusCode)
	}

	// 3. Missing fields
	resp = doRequest(t, app, "POST", "/api/auth/login", map[string]any{
		"email": "admin@localhost",
	})
	if resp.StatusCode != 401 {
		t.Fatalf("missing password: expected 401, got %d", resp.StatusCode)
	}
}

func TestMiddlewareRejectsMissingToken(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testAppWithAuth(t, s, reg)

	// 1. No Authorization header
	resp := doAuthRequest(t, app, "GET", "/api/_admin/entities", "", nil)
	body := readBody(t, resp)
	if resp.StatusCode != 401 {
		t.Fatalf("no token: expected 401, got %d: %s", resp.StatusCode, body)
	}

	var errResp engine.ErrorResponse
	json.Unmarshal(body, &errResp)
	if errResp.Error.Code != "UNAUTHORIZED" {
		t.Fatalf("expected UNAUTHORIZED, got %s", errResp.Error.Code)
	}

	// 2. Invalid token
	resp = doAuthRequest(t, app, "GET", "/api/_admin/entities", "invalid-token-value", nil)
	if resp.StatusCode != 401 {
		t.Fatalf("invalid token: expected 401, got %d", resp.StatusCode)
	}

	// 3. Auth endpoints still accessible without token
	resp = doRequest(t, app, "POST", "/api/auth/login", map[string]any{
		"email":    "admin@localhost",
		"password": "changeme",
	})
	if resp.StatusCode != 200 {
		t.Fatalf("login without token: expected 200, got %d", resp.StatusCode)
	}
}

func TestAdminRoleBypass(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testAppWithAuth(t, s, reg)

	const entityName = "_test_auth_admin_bypass"

	// Cleanup
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _permissions WHERE entity = $1", entityName)
		store.Exec(ctx, s.Pool, "DROP TABLE IF EXISTS "+entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _entities WHERE name = $1", entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _users WHERE email != 'admin@localhost'")
		store.Exec(ctx, s.Pool, "DELETE FROM _refresh_tokens")
		_ = metadata.Reload(ctx, s.Pool, reg)
	}()

	// Login as admin
	adminToken := loginAs(t, app, "admin@localhost", "changeme")

	// Create test entity (admin can access admin routes)
	resp := doAuthRequest(t, app, "POST", "/api/_admin/entities", adminToken, map[string]any{
		"name": entityName, "table": entityName,
		"primary_key": map[string]any{"field": "id", "type": "uuid", "generated": true},
		"fields": []any{
			map[string]any{"name": "id", "type": "uuid"},
			map[string]any{"name": "name", "type": "string", "required": true},
		},
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create entity: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// Admin can CRUD without any permissions defined
	resp = doAuthRequest(t, app, "POST", "/api/"+entityName, adminToken, map[string]any{
		"name": "Admin Created",
	})
	if resp.StatusCode != 201 {
		t.Fatalf("admin create: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	var cr map[string]any
	json.Unmarshal(readBody(t, resp), &cr)
	recordID := cr["data"].(map[string]any)["id"].(string)

	resp = doAuthRequest(t, app, "GET", "/api/"+entityName, adminToken, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("admin list: expected 200, got %d", resp.StatusCode)
	}

	resp = doAuthRequest(t, app, "GET", "/api/"+entityName+"/"+recordID, adminToken, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("admin get: expected 200, got %d", resp.StatusCode)
	}

	resp = doAuthRequest(t, app, "PUT", "/api/"+entityName+"/"+recordID, adminToken, map[string]any{
		"name": "Updated",
	})
	if resp.StatusCode != 200 {
		t.Fatalf("admin update: expected 200, got %d", resp.StatusCode)
	}

	resp = doAuthRequest(t, app, "DELETE", "/api/"+entityName+"/"+recordID, adminToken, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("admin delete: expected 200, got %d", resp.StatusCode)
	}
}

func TestPermissionGrantsAccess(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testAppWithAuth(t, s, reg)

	const entityName = "_test_auth_perm_grant"

	// Cleanup
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _permissions WHERE entity = $1", entityName)
		store.Exec(ctx, s.Pool, "DROP TABLE IF EXISTS "+entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _entities WHERE name = $1", entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _users WHERE email != 'admin@localhost'")
		store.Exec(ctx, s.Pool, "DELETE FROM _refresh_tokens")
		_ = metadata.Reload(ctx, s.Pool, reg)
	}()

	adminToken := loginAs(t, app, "admin@localhost", "changeme")

	// Create entity
	resp := doAuthRequest(t, app, "POST", "/api/_admin/entities", adminToken, map[string]any{
		"name": entityName, "table": entityName,
		"primary_key": map[string]any{"field": "id", "type": "uuid", "generated": true},
		"fields": []any{
			map[string]any{"name": "id", "type": "uuid"},
			map[string]any{"name": "name", "type": "string", "required": true},
		},
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create entity: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// Create viewer user with "viewer" role
	createTestUser(t, app, adminToken, "viewer@test.com", "password123", []string{"viewer"})

	// Create permissions for viewer role: read + create
	for _, action := range []string{"read", "create"} {
		resp = doAuthRequest(t, app, "POST", "/api/_admin/permissions", adminToken, map[string]any{
			"entity": entityName,
			"action": action,
			"roles":  []string{"viewer"},
		})
		if resp.StatusCode != 201 {
			t.Fatalf("create %s permission: expected 201, got %d: %s", action, resp.StatusCode, readBody(t, resp))
		}
	}

	// Login as viewer
	viewerToken := loginAs(t, app, "viewer@test.com", "password123")

	// Viewer can create (has permission)
	resp = doAuthRequest(t, app, "POST", "/api/"+entityName, viewerToken, map[string]any{
		"name": "Viewer Created",
	})
	if resp.StatusCode != 201 {
		t.Fatalf("viewer create: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// Viewer can read (has permission)
	resp = doAuthRequest(t, app, "GET", "/api/"+entityName, viewerToken, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("viewer list: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}
}

func TestPermissionDeniesAccess(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testAppWithAuth(t, s, reg)

	const entityName = "_test_auth_perm_deny"

	// Cleanup
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _permissions WHERE entity = $1", entityName)
		store.Exec(ctx, s.Pool, "DROP TABLE IF EXISTS "+entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _entities WHERE name = $1", entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _users WHERE email != 'admin@localhost'")
		store.Exec(ctx, s.Pool, "DELETE FROM _refresh_tokens")
		_ = metadata.Reload(ctx, s.Pool, reg)
	}()

	adminToken := loginAs(t, app, "admin@localhost", "changeme")

	// Create entity
	resp := doAuthRequest(t, app, "POST", "/api/_admin/entities", adminToken, map[string]any{
		"name": entityName, "table": entityName,
		"primary_key": map[string]any{"field": "id", "type": "uuid", "generated": true},
		"fields": []any{
			map[string]any{"name": "id", "type": "uuid"},
			map[string]any{"name": "name", "type": "string", "required": true},
		},
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create entity: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// Create user with "viewer" role but NO permissions for this entity
	createTestUser(t, app, adminToken, "noperm@test.com", "password123", []string{"viewer"})

	viewerToken := loginAs(t, app, "noperm@test.com", "password123")

	// Should be denied (no permission = denied)
	resp = doAuthRequest(t, app, "GET", "/api/"+entityName, viewerToken, nil)
	body := readBody(t, resp)
	if resp.StatusCode != 403 {
		t.Fatalf("no permission list: expected 403, got %d: %s", resp.StatusCode, body)
	}
	var errResp engine.ErrorResponse
	json.Unmarshal(body, &errResp)
	if errResp.Error.Code != "FORBIDDEN" {
		t.Fatalf("expected FORBIDDEN, got %s", errResp.Error.Code)
	}

	resp = doAuthRequest(t, app, "POST", "/api/"+entityName, viewerToken, map[string]any{
		"name": "Should Fail",
	})
	if resp.StatusCode != 403 {
		t.Fatalf("no permission create: expected 403, got %d", resp.StatusCode)
	}

	// Non-admin user can't access admin routes
	resp = doAuthRequest(t, app, "GET", "/api/_admin/entities", viewerToken, nil)
	if resp.StatusCode != 403 {
		t.Fatalf("non-admin accessing admin: expected 403, got %d", resp.StatusCode)
	}
}

func TestRowLevelFiltering(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testAppWithAuth(t, s, reg)

	const entityName = "_test_auth_row_filter"

	// Cleanup
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _permissions WHERE entity = $1", entityName)
		store.Exec(ctx, s.Pool, "DROP TABLE IF EXISTS "+entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _entities WHERE name = $1", entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _users WHERE email != 'admin@localhost'")
		store.Exec(ctx, s.Pool, "DELETE FROM _refresh_tokens")
		_ = metadata.Reload(ctx, s.Pool, reg)
	}()

	adminToken := loginAs(t, app, "admin@localhost", "changeme")

	// Create entity with department field
	resp := doAuthRequest(t, app, "POST", "/api/_admin/entities", adminToken, map[string]any{
		"name": entityName, "table": entityName,
		"primary_key": map[string]any{"field": "id", "type": "uuid", "generated": true},
		"fields": []any{
			map[string]any{"name": "id", "type": "uuid"},
			map[string]any{"name": "name", "type": "string", "required": true},
			map[string]any{"name": "department", "type": "string", "required": true},
		},
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create entity: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// Insert records as admin: 3 in "sales", 2 in "engineering"
	for i := 0; i < 3; i++ {
		doAuthRequest(t, app, "POST", "/api/"+entityName, adminToken, map[string]any{
			"name": fmt.Sprintf("Sales Person %d", i+1), "department": "sales",
		})
	}
	for i := 0; i < 2; i++ {
		doAuthRequest(t, app, "POST", "/api/"+entityName, adminToken, map[string]any{
			"name": fmt.Sprintf("Engineer %d", i+1), "department": "engineering",
		})
	}

	// Create sales_rep user
	createTestUser(t, app, adminToken, "salesrep@test.com", "password123", []string{"sales_rep"})

	// Create read permission with condition: department = "sales"
	resp = doAuthRequest(t, app, "POST", "/api/_admin/permissions", adminToken, map[string]any{
		"entity": entityName,
		"action": "read",
		"roles":  []string{"sales_rep"},
		"conditions": []map[string]any{
			{"field": "department", "operator": "eq", "value": "sales"},
		},
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create permission: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// Login as sales_rep
	salesToken := loginAs(t, app, "salesrep@test.com", "password123")

	// List should return only sales records
	resp = doAuthRequest(t, app, "GET", "/api/"+entityName, salesToken, nil)
	body := readBody(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("sales list: expected 200, got %d: %s", resp.StatusCode, body)
	}

	var listResp map[string]any
	json.Unmarshal(body, &listResp)
	rows := listResp["data"].([]any)
	meta := listResp["meta"].(map[string]any)

	if len(rows) != 3 {
		t.Fatalf("expected 3 sales records, got %d", len(rows))
	}

	// Verify total in meta matches filtered count
	total := meta["total"]
	// total could be float64 from JSON
	switch v := total.(type) {
	case float64:
		if int(v) != 3 {
			t.Fatalf("expected total=3, got %v", total)
		}
	default:
		t.Fatalf("unexpected total type: %T = %v", total, total)
	}

	// Verify all records have department=sales
	for _, r := range rows {
		row := r.(map[string]any)
		if row["department"] != "sales" {
			t.Fatalf("expected department=sales, got %v", row["department"])
		}
	}

	// Admin should see all 5 records
	resp = doAuthRequest(t, app, "GET", "/api/"+entityName, adminToken, nil)
	body = readBody(t, resp)
	json.Unmarshal(body, &listResp)
	adminRows := listResp["data"].([]any)
	if len(adminRows) != 5 {
		t.Fatalf("admin expected 5 records, got %d", len(adminRows))
	}
}

func TestWritePermissionWithConditions(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testAppWithAuth(t, s, reg)

	const entityName = "_test_auth_write_cond"

	// Cleanup
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _permissions WHERE entity = $1", entityName)
		store.Exec(ctx, s.Pool, "DROP TABLE IF EXISTS "+entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _entities WHERE name = $1", entityName)
		store.Exec(ctx, s.Pool, "DELETE FROM _users WHERE email != 'admin@localhost'")
		store.Exec(ctx, s.Pool, "DELETE FROM _refresh_tokens")
		_ = metadata.Reload(ctx, s.Pool, reg)
	}()

	adminToken := loginAs(t, app, "admin@localhost", "changeme")

	// Create entity with status field
	resp := doAuthRequest(t, app, "POST", "/api/_admin/entities", adminToken, map[string]any{
		"name": entityName, "table": entityName,
		"primary_key": map[string]any{"field": "id", "type": "uuid", "generated": true},
		"fields": []any{
			map[string]any{"name": "id", "type": "uuid"},
			map[string]any{"name": "name", "type": "string", "required": true},
			map[string]any{"name": "status", "type": "string"},
		},
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create entity: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// Create editor user
	createTestUser(t, app, adminToken, "editor@test.com", "password123", []string{"editor"})

	// Create permissions: editor can read (all), create, and update only when status=draft
	for _, action := range []string{"read", "create"} {
		doAuthRequest(t, app, "POST", "/api/_admin/permissions", adminToken, map[string]any{
			"entity": entityName, "action": action, "roles": []string{"editor"},
		})
	}
	resp = doAuthRequest(t, app, "POST", "/api/_admin/permissions", adminToken, map[string]any{
		"entity": entityName,
		"action": "update",
		"roles":  []string{"editor"},
		"conditions": []map[string]any{
			{"field": "status", "operator": "eq", "value": "draft"},
		},
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create update permission: expected 201, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// Insert records as admin: one draft, one published
	resp = doAuthRequest(t, app, "POST", "/api/"+entityName, adminToken, map[string]any{
		"name": "Draft Doc", "status": "draft",
	})
	body := readBody(t, resp)
	var cr map[string]any
	json.Unmarshal(body, &cr)
	draftID := cr["data"].(map[string]any)["id"].(string)

	resp = doAuthRequest(t, app, "POST", "/api/"+entityName, adminToken, map[string]any{
		"name": "Published Doc", "status": "published",
	})
	body = readBody(t, resp)
	json.Unmarshal(body, &cr)
	publishedID := cr["data"].(map[string]any)["id"].(string)

	// Login as editor
	editorToken := loginAs(t, app, "editor@test.com", "password123")

	// Editor can update draft record
	resp = doAuthRequest(t, app, "PUT", "/api/"+entityName+"/"+draftID, editorToken, map[string]any{
		"name": "Updated Draft",
	})
	if resp.StatusCode != 200 {
		t.Fatalf("editor update draft: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// Editor cannot update published record (condition fails)
	resp = doAuthRequest(t, app, "PUT", "/api/"+entityName+"/"+publishedID, editorToken, map[string]any{
		"name": "Should Fail",
	})
	if resp.StatusCode != 403 {
		t.Fatalf("editor update published: expected 403, got %d: %s", resp.StatusCode, readBody(t, resp))
	}
}

func TestUserCRUD(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testAppWithAuth(t, s, reg)

	// Cleanup
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _refresh_tokens")
		store.Exec(ctx, s.Pool, "DELETE FROM _users WHERE email != 'admin@localhost'")
	}()

	adminToken := loginAs(t, app, "admin@localhost", "changeme")

	// 1. Create user
	resp := doAuthRequest(t, app, "POST", "/api/_admin/users", adminToken, map[string]any{
		"email":    "newuser@test.com",
		"password": "securepass",
		"roles":    []string{"editor", "viewer"},
	})
	body := readBody(t, resp)
	if resp.StatusCode != 201 {
		t.Fatalf("create user: expected 201, got %d: %s", resp.StatusCode, body)
	}

	var cr map[string]any
	json.Unmarshal(body, &cr)
	userData := cr["data"].(map[string]any)
	userID := userData["id"].(string)
	if userID == "" {
		t.Fatal("expected user ID in response")
	}

	// Verify password_hash is never returned
	if _, hasHash := userData["password_hash"]; hasHash {
		t.Fatal("password_hash should never be returned in response")
	}

	// 2. List users
	resp = doAuthRequest(t, app, "GET", "/api/_admin/users", adminToken, nil)
	body = readBody(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("list users: expected 200, got %d: %s", resp.StatusCode, body)
	}
	var lr map[string]any
	json.Unmarshal(body, &lr)
	users := lr["data"].([]any)
	if len(users) < 2 {
		t.Fatalf("expected at least 2 users (admin + new), got %d", len(users))
	}
	// Verify no user has password_hash
	for _, u := range users {
		user := u.(map[string]any)
		if _, hasHash := user["password_hash"]; hasHash {
			t.Fatal("password_hash should never appear in list response")
		}
	}

	// 3. Get user by ID
	resp = doAuthRequest(t, app, "GET", "/api/_admin/users/"+userID, adminToken, nil)
	body = readBody(t, resp)
	if resp.StatusCode != 200 {
		t.Fatalf("get user: expected 200, got %d: %s", resp.StatusCode, body)
	}
	json.Unmarshal(body, &cr)
	if _, hasHash := cr["data"].(map[string]any)["password_hash"]; hasHash {
		t.Fatal("password_hash should never appear in get response")
	}

	// 4. Update user
	resp = doAuthRequest(t, app, "PUT", "/api/_admin/users/"+userID, adminToken, map[string]any{
		"email":  "updated@test.com",
		"roles":  []string{"admin"},
		"active": true,
	})
	if resp.StatusCode != 200 {
		t.Fatalf("update user: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// Verify the new user can login with existing password (not changed)
	resp = doRequest(t, app, "POST", "/api/auth/login", map[string]any{
		"email":    "updated@test.com",
		"password": "securepass",
	})
	if resp.StatusCode != 200 {
		t.Fatalf("login with updated email: expected 200, got %d", resp.StatusCode)
	}

	// 5. Update user with new password
	resp = doAuthRequest(t, app, "PUT", "/api/_admin/users/"+userID, adminToken, map[string]any{
		"email":    "updated@test.com",
		"password": "newpassword",
		"roles":    []string{"admin"},
		"active":   true,
	})
	if resp.StatusCode != 200 {
		t.Fatalf("update user password: expected 200, got %d", resp.StatusCode)
	}

	// Old password fails
	resp = doRequest(t, app, "POST", "/api/auth/login", map[string]any{
		"email":    "updated@test.com",
		"password": "securepass",
	})
	if resp.StatusCode != 401 {
		t.Fatalf("old password: expected 401, got %d", resp.StatusCode)
	}

	// New password works
	resp = doRequest(t, app, "POST", "/api/auth/login", map[string]any{
		"email":    "updated@test.com",
		"password": "newpassword",
	})
	if resp.StatusCode != 200 {
		t.Fatalf("new password: expected 200, got %d", resp.StatusCode)
	}

	// 6. Delete user
	resp = doAuthRequest(t, app, "DELETE", "/api/_admin/users/"+userID, adminToken, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("delete user: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 7. Verify deleted
	resp = doAuthRequest(t, app, "GET", "/api/_admin/users/"+userID, adminToken, nil)
	if resp.StatusCode != 404 {
		t.Fatalf("get deleted user: expected 404, got %d", resp.StatusCode)
	}
}

func TestPermissionCRUD(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testAppWithAuth(t, s, reg)

	// Cleanup
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _permissions WHERE entity = '_test_perm_crud'")
		store.Exec(ctx, s.Pool, "DELETE FROM _refresh_tokens")
		store.Exec(ctx, s.Pool, "DELETE FROM _users WHERE email != 'admin@localhost'")
	}()

	adminToken := loginAs(t, app, "admin@localhost", "changeme")

	// 1. Create permission
	resp := doAuthRequest(t, app, "POST", "/api/_admin/permissions", adminToken, map[string]any{
		"entity": "_test_perm_crud",
		"action": "read",
		"roles":  []string{"viewer"},
		"conditions": []map[string]any{
			{"field": "status", "operator": "eq", "value": "active"},
		},
	})
	body := readBody(t, resp)
	if resp.StatusCode != 201 {
		t.Fatalf("create permission: expected 201, got %d: %s", resp.StatusCode, body)
	}

	var cr map[string]any
	json.Unmarshal(body, &cr)
	permData := cr["data"].(map[string]any)
	permID := permData["id"].(string)
	if permID == "" {
		t.Fatal("expected permission ID in response")
	}

	// 2. List permissions
	resp = doAuthRequest(t, app, "GET", "/api/_admin/permissions", adminToken, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("list permissions: expected 200, got %d", resp.StatusCode)
	}

	// 3. Get permission by ID
	resp = doAuthRequest(t, app, "GET", "/api/_admin/permissions/"+permID, adminToken, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("get permission: expected 200, got %d", resp.StatusCode)
	}

	// 4. Update permission
	resp = doAuthRequest(t, app, "PUT", "/api/_admin/permissions/"+permID, adminToken, map[string]any{
		"entity": "_test_perm_crud",
		"action": "update",
		"roles":  []string{"editor", "viewer"},
	})
	if resp.StatusCode != 200 {
		t.Fatalf("update permission: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 5. Delete permission
	resp = doAuthRequest(t, app, "DELETE", "/api/_admin/permissions/"+permID, adminToken, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("delete permission: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// 6. Verify deleted
	resp = doAuthRequest(t, app, "GET", "/api/_admin/permissions/"+permID, adminToken, nil)
	if resp.StatusCode != 404 {
		t.Fatalf("get deleted permission: expected 404, got %d", resp.StatusCode)
	}
}

func TestDisabledUserCannotLogin(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	defer s.Close()

	reg := metadata.NewRegistry()
	_ = metadata.LoadAll(ctx, s.Pool, reg)
	app := testAppWithAuth(t, s, reg)

	// Cleanup
	defer func() {
		store.Exec(ctx, s.Pool, "DELETE FROM _refresh_tokens")
		store.Exec(ctx, s.Pool, "DELETE FROM _users WHERE email != 'admin@localhost'")
	}()

	adminToken := loginAs(t, app, "admin@localhost", "changeme")

	// Create user
	userID := createTestUser(t, app, adminToken, "disabled@test.com", "password123", []string{"viewer"})

	// User can login
	resp := doRequest(t, app, "POST", "/api/auth/login", map[string]any{
		"email": "disabled@test.com", "password": "password123",
	})
	if resp.StatusCode != 200 {
		t.Fatalf("active user login: expected 200, got %d", resp.StatusCode)
	}

	// Disable user
	active := false
	resp = doAuthRequest(t, app, "PUT", "/api/_admin/users/"+userID, adminToken, map[string]any{
		"email":  "disabled@test.com",
		"roles":  []string{"viewer"},
		"active": &active,
	})
	if resp.StatusCode != 200 {
		t.Fatalf("disable user: expected 200, got %d: %s", resp.StatusCode, readBody(t, resp))
	}

	// Disabled user cannot login
	resp = doRequest(t, app, "POST", "/api/auth/login", map[string]any{
		"email": "disabled@test.com", "password": "password123",
	})
	if resp.StatusCode != 401 {
		t.Fatalf("disabled user login: expected 401, got %d", resp.StatusCode)
	}
}
