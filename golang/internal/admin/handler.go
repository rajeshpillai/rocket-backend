package admin

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"rocket-backend/internal/auth"
	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

type Handler struct {
	store    *store.Store
	registry *metadata.Registry
	migrator *store.Migrator
}

func NewHandler(s *store.Store, reg *metadata.Registry, mig *store.Migrator) *Handler {
	return &Handler{store: s, registry: reg, migrator: mig}
}

func RegisterAdminRoutes(app *fiber.App, h *Handler, middleware ...fiber.Handler) {
	admin := app.Group("/api/_admin", middleware...)

	admin.Get("/entities", h.ListEntities)
	admin.Get("/entities/:name", h.GetEntity)
	admin.Post("/entities", h.CreateEntity)
	admin.Put("/entities/:name", h.UpdateEntity)
	admin.Delete("/entities/:name", h.DeleteEntity)

	admin.Get("/relations", h.ListRelations)
	admin.Get("/relations/:name", h.GetRelation)
	admin.Post("/relations", h.CreateRelation)
	admin.Put("/relations/:name", h.UpdateRelation)
	admin.Delete("/relations/:name", h.DeleteRelation)

	admin.Get("/rules", h.ListRules)
	admin.Get("/rules/:id", h.GetRule)
	admin.Post("/rules", h.CreateRule)
	admin.Put("/rules/:id", h.UpdateRule)
	admin.Delete("/rules/:id", h.DeleteRule)

	admin.Get("/state-machines", h.ListStateMachines)
	admin.Get("/state-machines/:id", h.GetStateMachine)
	admin.Post("/state-machines", h.CreateStateMachine)
	admin.Put("/state-machines/:id", h.UpdateStateMachine)
	admin.Delete("/state-machines/:id", h.DeleteStateMachine)

	admin.Get("/workflows", h.ListWorkflows)
	admin.Get("/workflows/:id", h.GetWorkflow)
	admin.Post("/workflows", h.CreateWorkflow)
	admin.Put("/workflows/:id", h.UpdateWorkflow)
	admin.Delete("/workflows/:id", h.DeleteWorkflow)

	admin.Get("/users", h.ListUsers)
	admin.Get("/users/:id", h.GetUser)
	admin.Post("/users", h.CreateUser)
	admin.Put("/users/:id", h.UpdateUser)
	admin.Delete("/users/:id", h.DeleteUser)

	admin.Get("/permissions", h.ListPermissions)
	admin.Get("/permissions/:id", h.GetPermission)
	admin.Post("/permissions", h.CreatePermission)
	admin.Put("/permissions/:id", h.UpdatePermission)
	admin.Delete("/permissions/:id", h.DeletePermission)

	admin.Get("/webhooks", h.ListWebhooks)
	admin.Get("/webhooks/:id", h.GetWebhook)
	admin.Post("/webhooks", h.CreateWebhook)
	admin.Put("/webhooks/:id", h.UpdateWebhook)
	admin.Delete("/webhooks/:id", h.DeleteWebhook)

	admin.Get("/webhook-logs", h.ListWebhookLogs)
	admin.Get("/webhook-logs/:id", h.GetWebhookLog)
	admin.Post("/webhook-logs/:id/retry", h.RetryWebhookLog)

	admin.Post("/invites/bulk", h.BulkCreateInvites)
	admin.Get("/invites", h.ListInvites)
	admin.Post("/invites", h.CreateInvite)
	admin.Delete("/invites/:id", h.DeleteInvite)

	admin.Get("/export", h.Export)
	admin.Post("/import", h.Import)
}

// --- Entity Endpoints ---

func (h *Handler) ListEntities(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.DB,
		"SELECT name, table_name, definition, created_at, updated_at FROM _entities ORDER BY name")
	if err != nil {
		return fmt.Errorf("list entities: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (h *Handler) GetEntity(c *fiber.Ctx) error {
	name := c.Params("name")
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT name, table_name, definition, created_at, updated_at FROM _entities WHERE name = %s", pb.Add(name)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Entity not found: " + name}})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (h *Handler) CreateEntity(c *fiber.Ctx) error {
	var entity metadata.Entity
	if err := c.BodyParser(&entity); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}

	if err := validateEntity(&entity); err != nil {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": err.Error()}})
	}

	// Check for duplicate
	existing := h.registry.GetEntity(entity.Name)
	if existing != nil {
		return c.Status(409).JSON(fiber.Map{"error": fiber.Map{"code": "CONFLICT", "message": "Entity already exists: " + entity.Name}})
	}

	defJSON, err := json.Marshal(entity)
	if err != nil {
		return fmt.Errorf("marshal entity: %w", err)
	}

	pb := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("INSERT INTO _entities (name, table_name, definition) VALUES (%s, %s, %s)",
			pb.Add(entity.Name), pb.Add(entity.Table), pb.Add(defJSON)),
		pb.Params()...)
	if err != nil {
		return fmt.Errorf("insert entity: %w", err)
	}

	// Auto-migrate: create the table
	if err := h.migrator.Migrate(c.Context(), &entity); err != nil {
		return fmt.Errorf("migrate entity %s: %w", entity.Name, err)
	}

	// Reload registry
	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.Status(201).JSON(fiber.Map{"data": entity})
}

func (h *Handler) UpdateEntity(c *fiber.Ctx) error {
	name := c.Params("name")
	existing := h.registry.GetEntity(name)
	if existing == nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Entity not found: " + name}})
	}

	var entity metadata.Entity
	if err := c.BodyParser(&entity); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}
	entity.Name = name // ensure name matches URL

	if err := validateEntity(&entity); err != nil {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": err.Error()}})
	}

	defJSON, err := json.Marshal(entity)
	if err != nil {
		return fmt.Errorf("marshal entity: %w", err)
	}

	pb := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("UPDATE _entities SET table_name = %s, definition = %s, updated_at = %s WHERE name = %s",
			pb.Add(entity.Table), pb.Add(defJSON), h.store.Dialect.NowExpr(), pb.Add(name)),
		pb.Params()...)
	if err != nil {
		return fmt.Errorf("update entity: %w", err)
	}

	if err := h.migrator.Migrate(c.Context(), &entity); err != nil {
		return fmt.Errorf("migrate entity %s: %w", entity.Name, err)
	}

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": entity})
}

func (h *Handler) DeleteEntity(c *fiber.Ctx) error {
	name := c.Params("name")
	existing := h.registry.GetEntity(name)
	if existing == nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Entity not found: " + name}})
	}

	// Delete relations first (FK constraint)
	pb := h.store.Dialect.NewParamBuilder()
	_, err := store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("DELETE FROM _relations WHERE source = %s OR target = %s", pb.Add(name), pb.Add(name)),
		pb.Params()...)
	if err != nil {
		return fmt.Errorf("delete relations for entity %s: %w", name, err)
	}

	pb2 := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("DELETE FROM _entities WHERE name = %s", pb2.Add(name)),
		pb2.Params()...)
	if err != nil {
		return fmt.Errorf("delete entity %s: %w", name, err)
	}

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"name": name, "deleted": true}})
}

// --- Relation Endpoints ---

func (h *Handler) ListRelations(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.DB,
		"SELECT name, source, target, definition, created_at, updated_at FROM _relations ORDER BY name")
	if err != nil {
		return fmt.Errorf("list relations: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (h *Handler) GetRelation(c *fiber.Ctx) error {
	name := c.Params("name")
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT name, source, target, definition, created_at, updated_at FROM _relations WHERE name = %s", pb.Add(name)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Relation not found: " + name}})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (h *Handler) CreateRelation(c *fiber.Ctx) error {
	var rel metadata.Relation
	if err := c.BodyParser(&rel); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}

	if err := validateRelation(&rel, h.registry); err != nil {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": err.Error()}})
	}

	// Check for duplicate
	if existing := h.registry.GetRelation(rel.Name); existing != nil {
		return c.Status(409).JSON(fiber.Map{"error": fiber.Map{"code": "CONFLICT", "message": "Relation already exists: " + rel.Name}})
	}

	defJSON, err := json.Marshal(rel)
	if err != nil {
		return fmt.Errorf("marshal relation: %w", err)
	}

	pb := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("INSERT INTO _relations (name, source, target, definition) VALUES (%s, %s, %s, %s)",
			pb.Add(rel.Name), pb.Add(rel.Source), pb.Add(rel.Target), pb.Add(defJSON)),
		pb.Params()...)
	if err != nil {
		return fmt.Errorf("insert relation: %w", err)
	}

	// Create join table for many-to-many
	if rel.IsManyToMany() {
		sourceEntity := h.registry.GetEntity(rel.Source)
		targetEntity := h.registry.GetEntity(rel.Target)
		if sourceEntity != nil && targetEntity != nil {
			if err := h.migrator.MigrateJoinTable(c.Context(), &rel, sourceEntity, targetEntity); err != nil {
				return fmt.Errorf("create join table: %w", err)
			}
		}
	}

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.Status(201).JSON(fiber.Map{"data": rel})
}

func (h *Handler) UpdateRelation(c *fiber.Ctx) error {
	name := c.Params("name")
	existing := h.registry.GetRelation(name)
	if existing == nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Relation not found: " + name}})
	}

	var rel metadata.Relation
	if err := c.BodyParser(&rel); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}
	rel.Name = name

	if err := validateRelation(&rel, h.registry); err != nil {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": err.Error()}})
	}

	defJSON, err := json.Marshal(rel)
	if err != nil {
		return fmt.Errorf("marshal relation: %w", err)
	}

	pb := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("UPDATE _relations SET source = %s, target = %s, definition = %s, updated_at = %s WHERE name = %s",
			pb.Add(rel.Source), pb.Add(rel.Target), pb.Add(defJSON), h.store.Dialect.NowExpr(), pb.Add(name)),
		pb.Params()...)
	if err != nil {
		return fmt.Errorf("update relation: %w", err)
	}

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": rel})
}

func (h *Handler) DeleteRelation(c *fiber.Ctx) error {
	name := c.Params("name")
	existing := h.registry.GetRelation(name)
	if existing == nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Relation not found: " + name}})
	}

	pb := h.store.Dialect.NewParamBuilder()
	_, err := store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("DELETE FROM _relations WHERE name = %s", pb.Add(name)),
		pb.Params()...)
	if err != nil {
		return fmt.Errorf("delete relation %s: %w", name, err)
	}

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"name": name, "deleted": true}})
}

// --- Rule Endpoints ---

func (h *Handler) ListRules(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.DB,
		"SELECT id, entity, hook, type, definition, priority, active, created_at, updated_at FROM _rules ORDER BY entity, priority")
	if err != nil {
		return fmt.Errorf("list rules: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	if h.store.Dialect.NeedsBoolFix() {
		store.NormalizeBooleans(rows, []string{"active"})
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (h *Handler) GetRule(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id, entity, hook, type, definition, priority, active, created_at, updated_at FROM _rules WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Rule not found: " + id}})
	}
	if h.store.Dialect.NeedsBoolFix() {
		store.NormalizeBooleans([]map[string]any{row}, []string{"active"})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (h *Handler) CreateRule(c *fiber.Ctx) error {
	var rule metadata.Rule
	if err := c.BodyParser(&rule); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}

	if err := validateRule(&rule, h.registry); err != nil {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": err.Error()}})
	}

	defJSON, err := json.Marshal(rule.Definition)
	if err != nil {
		return fmt.Errorf("marshal rule definition: %w", err)
	}

	id := store.GenerateUUID()
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("INSERT INTO _rules (id, entity, hook, type, definition, priority, active) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
			pb.Add(id), pb.Add(rule.Entity), pb.Add(rule.Hook), pb.Add(rule.Type), pb.Add(defJSON), pb.Add(rule.Priority), pb.Add(rule.Active)),
		pb.Params()...)
	if err != nil {
		return fmt.Errorf("insert rule: %w", err)
	}
	rule.ID = fmt.Sprintf("%v", row["id"])

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.Status(201).JSON(fiber.Map{"data": rule})
}

func (h *Handler) UpdateRule(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	_, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id FROM _rules WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Rule not found: " + id}})
	}

	var rule metadata.Rule
	if err := c.BodyParser(&rule); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}
	rule.ID = id

	if err := validateRule(&rule, h.registry); err != nil {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": err.Error()}})
	}

	defJSON, err := json.Marshal(rule.Definition)
	if err != nil {
		return fmt.Errorf("marshal rule definition: %w", err)
	}

	pb2 := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("UPDATE _rules SET entity = %s, hook = %s, type = %s, definition = %s, priority = %s, active = %s, updated_at = %s WHERE id = %s",
			pb2.Add(rule.Entity), pb2.Add(rule.Hook), pb2.Add(rule.Type), pb2.Add(defJSON), pb2.Add(rule.Priority), pb2.Add(rule.Active), h.store.Dialect.NowExpr(), pb2.Add(id)),
		pb2.Params()...)
	if err != nil {
		return fmt.Errorf("update rule: %w", err)
	}

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": rule})
}

func (h *Handler) DeleteRule(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	_, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id FROM _rules WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Rule not found: " + id}})
	}

	pb2 := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("DELETE FROM _rules WHERE id = %s", pb2.Add(id)),
		pb2.Params()...)
	if err != nil {
		return fmt.Errorf("delete rule %s: %w", id, err)
	}

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"id": id, "deleted": true}})
}

// --- State Machine Endpoints ---

func (h *Handler) ListStateMachines(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.DB,
		"SELECT id, entity, field, definition, active, created_at, updated_at FROM _state_machines ORDER BY entity")
	if err != nil {
		return fmt.Errorf("list state machines: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	if h.store.Dialect.NeedsBoolFix() {
		store.NormalizeBooleans(rows, []string{"active"})
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (h *Handler) GetStateMachine(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id, entity, field, definition, active, created_at, updated_at FROM _state_machines WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "State machine not found: " + id}})
	}
	if h.store.Dialect.NeedsBoolFix() {
		store.NormalizeBooleans([]map[string]any{row}, []string{"active"})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (h *Handler) CreateStateMachine(c *fiber.Ctx) error {
	var sm metadata.StateMachine
	if err := c.BodyParser(&sm); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}

	if err := validateStateMachine(&sm, h.registry); err != nil {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": err.Error()}})
	}

	defJSON, err := json.Marshal(sm.Definition)
	if err != nil {
		return fmt.Errorf("marshal state machine definition: %w", err)
	}

	id := store.GenerateUUID()
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("INSERT INTO _state_machines (id, entity, field, definition, active) VALUES (%s, %s, %s, %s, %s) RETURNING id",
			pb.Add(id), pb.Add(sm.Entity), pb.Add(sm.Field), pb.Add(defJSON), pb.Add(sm.Active)),
		pb.Params()...)
	if err != nil {
		return fmt.Errorf("insert state machine: %w", err)
	}
	sm.ID = fmt.Sprintf("%v", row["id"])

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.Status(201).JSON(fiber.Map{"data": sm})
}

func (h *Handler) UpdateStateMachine(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	_, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id FROM _state_machines WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "State machine not found: " + id}})
	}

	var sm metadata.StateMachine
	if err := c.BodyParser(&sm); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}
	sm.ID = id

	if err := validateStateMachine(&sm, h.registry); err != nil {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": err.Error()}})
	}

	defJSON, err := json.Marshal(sm.Definition)
	if err != nil {
		return fmt.Errorf("marshal state machine definition: %w", err)
	}

	pb2 := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("UPDATE _state_machines SET entity = %s, field = %s, definition = %s, active = %s, updated_at = %s WHERE id = %s",
			pb2.Add(sm.Entity), pb2.Add(sm.Field), pb2.Add(defJSON), pb2.Add(sm.Active), h.store.Dialect.NowExpr(), pb2.Add(id)),
		pb2.Params()...)
	if err != nil {
		return fmt.Errorf("update state machine: %w", err)
	}

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": sm})
}

func (h *Handler) DeleteStateMachine(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	_, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id FROM _state_machines WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "State machine not found: " + id}})
	}

	pb2 := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("DELETE FROM _state_machines WHERE id = %s", pb2.Add(id)),
		pb2.Params()...)
	if err != nil {
		return fmt.Errorf("delete state machine %s: %w", id, err)
	}

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"id": id, "deleted": true}})
}

// --- Workflow Endpoints ---

func (h *Handler) ListWorkflows(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.DB,
		"SELECT id, name, trigger, context, steps, active, created_at, updated_at FROM _workflows ORDER BY name")
	if err != nil {
		return fmt.Errorf("list workflows: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	if h.store.Dialect.NeedsBoolFix() {
		store.NormalizeBooleans(rows, []string{"active"})
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (h *Handler) GetWorkflow(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id, name, trigger, context, steps, active, created_at, updated_at FROM _workflows WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Workflow not found: " + id}})
	}
	if h.store.Dialect.NeedsBoolFix() {
		store.NormalizeBooleans([]map[string]any{row}, []string{"active"})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (h *Handler) CreateWorkflow(c *fiber.Ctx) error {
	var wf metadata.Workflow
	if err := c.BodyParser(&wf); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}

	if err := validateWorkflow(&wf, h.registry); err != nil {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": err.Error()}})
	}

	triggerJSON, err := json.Marshal(wf.Trigger)
	if err != nil {
		return fmt.Errorf("marshal workflow trigger: %w", err)
	}
	contextJSON, err := json.Marshal(wf.Context)
	if err != nil {
		return fmt.Errorf("marshal workflow context: %w", err)
	}
	stepsJSON, err := json.Marshal(wf.Steps)
	if err != nil {
		return fmt.Errorf("marshal workflow steps: %w", err)
	}

	id := store.GenerateUUID()
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("INSERT INTO _workflows (id, name, trigger, context, steps, active) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
			pb.Add(id), pb.Add(wf.Name), pb.Add(triggerJSON), pb.Add(contextJSON), pb.Add(stepsJSON), pb.Add(wf.Active)),
		pb.Params()...)
	if err != nil {
		return fmt.Errorf("insert workflow: %w", err)
	}
	wf.ID = fmt.Sprintf("%v", row["id"])

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.Status(201).JSON(fiber.Map{"data": wf})
}

func (h *Handler) UpdateWorkflow(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	_, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id FROM _workflows WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Workflow not found: " + id}})
	}

	var wf metadata.Workflow
	if err := c.BodyParser(&wf); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}
	wf.ID = id

	if err := validateWorkflow(&wf, h.registry); err != nil {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": err.Error()}})
	}

	triggerJSON, err := json.Marshal(wf.Trigger)
	if err != nil {
		return fmt.Errorf("marshal workflow trigger: %w", err)
	}
	contextJSON, err := json.Marshal(wf.Context)
	if err != nil {
		return fmt.Errorf("marshal workflow context: %w", err)
	}
	stepsJSON, err := json.Marshal(wf.Steps)
	if err != nil {
		return fmt.Errorf("marshal workflow steps: %w", err)
	}

	pb2 := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("UPDATE _workflows SET name = %s, trigger = %s, context = %s, steps = %s, active = %s, updated_at = %s WHERE id = %s",
			pb2.Add(wf.Name), pb2.Add(triggerJSON), pb2.Add(contextJSON), pb2.Add(stepsJSON), pb2.Add(wf.Active), h.store.Dialect.NowExpr(), pb2.Add(id)),
		pb2.Params()...)
	if err != nil {
		return fmt.Errorf("update workflow: %w", err)
	}

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": wf})
}

func (h *Handler) DeleteWorkflow(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	_, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id FROM _workflows WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Workflow not found: " + id}})
	}

	pb2 := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("DELETE FROM _workflows WHERE id = %s", pb2.Add(id)),
		pb2.Params()...)
	if err != nil {
		return fmt.Errorf("delete workflow %s: %w", id, err)
	}

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"id": id, "deleted": true}})
}

// --- Validation ---

func validateEntity(e *metadata.Entity) error {
	if e.Name == "" {
		return fmt.Errorf("entity name is required")
	}
	if e.Table == "" {
		return fmt.Errorf("table name is required")
	}
	if len(e.Fields) == 0 {
		return fmt.Errorf("entity must have at least one field")
	}
	if e.PrimaryKey.Field == "" {
		return fmt.Errorf("primary key field is required")
	}
	if !e.HasField(e.PrimaryKey.Field) {
		return fmt.Errorf("primary key field %s not found in fields", e.PrimaryKey.Field)
	}

	// Validate slug config if present
	if e.Slug != nil {
		slugField := e.GetField(e.Slug.Field)
		if slugField == nil {
			return fmt.Errorf("slug field %q not found in fields", e.Slug.Field)
		}
		if slugField.Type != "string" && slugField.Type != "text" {
			return fmt.Errorf("slug field %q must be of type string or text", e.Slug.Field)
		}
		if !slugField.Unique {
			return fmt.Errorf("slug field %q must have unique: true", e.Slug.Field)
		}
		if e.Slug.Source != "" && !e.HasField(e.Slug.Source) {
			return fmt.Errorf("slug source field %q not found in fields", e.Slug.Source)
		}
	}

	return nil
}

func validateRule(r *metadata.Rule, reg *metadata.Registry) error {
	if r.Entity == "" {
		return fmt.Errorf("entity is required")
	}
	if reg.GetEntity(r.Entity) == nil {
		return fmt.Errorf("entity not found: %s", r.Entity)
	}
	if r.Hook != "before_write" && r.Hook != "before_delete" {
		return fmt.Errorf("invalid hook: %s (must be before_write or before_delete)", r.Hook)
	}
	if r.Type != "field" && r.Type != "expression" && r.Type != "computed" {
		return fmt.Errorf("invalid rule type: %s (must be field, expression, or computed)", r.Type)
	}
	return nil
}

func validateStateMachine(sm *metadata.StateMachine, reg *metadata.Registry) error {
	if sm.Entity == "" {
		return fmt.Errorf("entity is required")
	}
	if reg.GetEntity(sm.Entity) == nil {
		return fmt.Errorf("entity not found: %s", sm.Entity)
	}
	if sm.Field == "" {
		return fmt.Errorf("field is required")
	}
	if len(sm.Definition.Transitions) == 0 {
		return fmt.Errorf("at least one transition is required")
	}
	return nil
}

func validateWorkflow(wf *metadata.Workflow, reg *metadata.Registry) error {
	if wf.Name == "" {
		return fmt.Errorf("workflow name is required")
	}
	if wf.Trigger.Type == "" {
		return fmt.Errorf("trigger type is required")
	}
	if wf.Trigger.Entity == "" {
		return fmt.Errorf("trigger entity is required")
	}
	if len(wf.Steps) == 0 {
		return fmt.Errorf("at least one step is required")
	}

	// Validate step IDs are unique and types are valid
	stepIDs := make(map[string]bool, len(wf.Steps))
	for _, s := range wf.Steps {
		if s.ID == "" {
			return fmt.Errorf("step id is required")
		}
		if stepIDs[s.ID] {
			return fmt.Errorf("duplicate step id: %s", s.ID)
		}
		stepIDs[s.ID] = true
		if s.Type != "action" && s.Type != "condition" && s.Type != "approval" {
			return fmt.Errorf("invalid step type: %s (must be action, condition, or approval)", s.Type)
		}
	}

	// Validate goto targets reference valid step IDs or "end"
	validTarget := func(sg *metadata.StepGoto) error {
		if sg == nil {
			return nil
		}
		if sg.Goto == "end" {
			return nil
		}
		if !stepIDs[sg.Goto] {
			return fmt.Errorf("goto target not found: %s", sg.Goto)
		}
		return nil
	}
	for _, s := range wf.Steps {
		if err := validTarget(s.Then); err != nil {
			return err
		}
		if err := validTarget(s.OnTrue); err != nil {
			return err
		}
		if err := validTarget(s.OnFalse); err != nil {
			return err
		}
		if err := validTarget(s.OnApprove); err != nil {
			return err
		}
		if err := validTarget(s.OnReject); err != nil {
			return err
		}
		if err := validTarget(s.OnTimeout); err != nil {
			return err
		}
	}

	return nil
}

// --- User Endpoints ---

func (h *Handler) ListUsers(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.DB,
		"SELECT id, email, roles, active, created_at, updated_at FROM _users ORDER BY email")
	if err != nil {
		return fmt.Errorf("list users: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	if h.store.Dialect.NeedsBoolFix() {
		store.NormalizeBooleans(rows, []string{"active"})
	}
	// Normalize roles from TEXT[]/JSON text to []string
	for _, row := range rows {
		row["roles"] = metadata.ParseStringArray(row["roles"])
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (h *Handler) GetUser(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id, email, roles, active, created_at, updated_at FROM _users WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "User not found: " + id}})
	}
	if h.store.Dialect.NeedsBoolFix() {
		store.NormalizeBooleans([]map[string]any{row}, []string{"active"})
	}
	row["roles"] = metadata.ParseStringArray(row["roles"])
	return c.JSON(fiber.Map{"data": row})
}

func (h *Handler) CreateUser(c *fiber.Ctx) error {
	var body struct {
		Email    string   `json:"email"`
		Password string   `json:"password"`
		Roles    []string `json:"roles"`
		Active   *bool    `json:"active"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}

	if body.Email == "" {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": "email is required"}})
	}
	if body.Password == "" {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": "password is required"}})
	}

	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}

	active := true
	if body.Active != nil {
		active = *body.Active
	}
	if body.Roles == nil {
		body.Roles = []string{}
	}

	id := store.GenerateUUID()
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("INSERT INTO _users (id, email, password_hash, roles, active) VALUES (%s, %s, %s, %s, %s) RETURNING id, email, roles, active, created_at, updated_at",
			pb.Add(id), pb.Add(body.Email), pb.Add(hash), pb.Add(h.store.Dialect.ArrayParam(body.Roles)), pb.Add(active)),
		pb.Params()...)
	if err != nil {
		return fmt.Errorf("insert user: %w", err)
	}
	row["roles"] = metadata.ParseStringArray(row["roles"])

	return c.Status(201).JSON(fiber.Map{"data": row})
}

func (h *Handler) UpdateUser(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	_, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id FROM _users WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "User not found: " + id}})
	}

	var body struct {
		Email    string   `json:"email"`
		Password string   `json:"password"`
		Roles    []string `json:"roles"`
		Active   *bool    `json:"active"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}

	if body.Email == "" {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": "email is required"}})
	}

	if body.Roles == nil {
		body.Roles = []string{}
	}

	// If password provided, update hash; otherwise keep existing
	if body.Password != "" {
		hash, err := auth.HashPassword(body.Password)
		if err != nil {
			return fmt.Errorf("hash password: %w", err)
		}
		pb2 := h.store.Dialect.NewParamBuilder()
		_, err = store.Exec(c.Context(), h.store.DB,
			fmt.Sprintf("UPDATE _users SET email = %s, password_hash = %s, roles = %s, active = %s, updated_at = %s WHERE id = %s",
				pb2.Add(body.Email), pb2.Add(hash), pb2.Add(h.store.Dialect.ArrayParam(body.Roles)), pb2.Add(body.Active), h.store.Dialect.NowExpr(), pb2.Add(id)),
			pb2.Params()...)
		if err != nil {
			return fmt.Errorf("update user: %w", err)
		}
	} else {
		pb2 := h.store.Dialect.NewParamBuilder()
		_, err = store.Exec(c.Context(), h.store.DB,
			fmt.Sprintf("UPDATE _users SET email = %s, roles = %s, active = %s, updated_at = %s WHERE id = %s",
				pb2.Add(body.Email), pb2.Add(h.store.Dialect.ArrayParam(body.Roles)), pb2.Add(body.Active), h.store.Dialect.NowExpr(), pb2.Add(id)),
			pb2.Params()...)
		if err != nil {
			return fmt.Errorf("update user: %w", err)
		}
	}

	pb3 := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id, email, roles, active, created_at, updated_at FROM _users WHERE id = %s", pb3.Add(id)),
		pb3.Params()...)
	if err != nil {
		return fmt.Errorf("fetch updated user: %w", err)
	}
	if h.store.Dialect.NeedsBoolFix() {
		store.NormalizeBooleans([]map[string]any{row}, []string{"active"})
	}
	row["roles"] = metadata.ParseStringArray(row["roles"])

	return c.JSON(fiber.Map{"data": row})
}

func (h *Handler) DeleteUser(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	_, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id FROM _users WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "User not found: " + id}})
	}

	pb2 := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("DELETE FROM _users WHERE id = %s", pb2.Add(id)),
		pb2.Params()...)
	if err != nil {
		return fmt.Errorf("delete user %s: %w", id, err)
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"id": id, "deleted": true}})
}

// --- Invite Endpoints ---

func (h *Handler) CreateInvite(c *fiber.Ctx) error {
	var body struct {
		Email string   `json:"email"`
		Roles []string `json:"roles"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}

	if body.Email == "" {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": "email is required"}})
	}
	if body.Roles == nil {
		body.Roles = []string{}
	}

	// Check email not already a user
	pb := h.store.Dialect.NewParamBuilder()
	_, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id FROM _users WHERE email = %s", pb.Add(body.Email)),
		pb.Params()...)
	if err == nil {
		return c.Status(409).JSON(fiber.Map{"error": fiber.Map{"code": "CONFLICT", "message": "A user with this email already exists"}})
	}

	// Check no pending invite for this email
	pb2 := h.store.Dialect.NewParamBuilder()
	_, err = store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id FROM _invites WHERE email = %s AND accepted_at IS NULL AND expires_at > %s",
			pb2.Add(body.Email), h.store.Dialect.NowExpr()),
		pb2.Params()...)
	if err == nil {
		return c.Status(409).JSON(fiber.Map{"error": fiber.Map{"code": "CONFLICT", "message": "A pending invite already exists for this email"}})
	}

	token := store.GenerateUUID()
	expiresAt := time.Now().Add(72 * time.Hour)

	var invitedBy *string
	if user, ok := c.Locals("user").(*metadata.UserContext); ok && user != nil {
		invitedBy = &user.ID
	}

	id := store.GenerateUUID()
	pb3 := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("INSERT INTO _invites (id, email, roles, token, expires_at, invited_by) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id, email, roles, token, expires_at, invited_by, created_at",
			pb3.Add(id), pb3.Add(body.Email), pb3.Add(h.store.Dialect.ArrayParam(body.Roles)), pb3.Add(token), pb3.Add(expiresAt), pb3.Add(invitedBy)),
		pb3.Params()...)
	if err != nil {
		return fmt.Errorf("insert invite: %w", err)
	}
	row["roles"] = metadata.ParseStringArray(row["roles"])

	return c.Status(201).JSON(fiber.Map{"data": row})
}

func (h *Handler) ListInvites(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.DB,
		"SELECT id, email, roles, token, expires_at, accepted_at, invited_by, created_at FROM _invites ORDER BY created_at DESC")
	if err != nil {
		return fmt.Errorf("list invites: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	for _, r := range rows {
		r["roles"] = metadata.ParseStringArray(r["roles"])
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (h *Handler) DeleteInvite(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	_, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id FROM _invites WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Invite not found: " + id}})
	}

	pb2 := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("DELETE FROM _invites WHERE id = %s", pb2.Add(id)),
		pb2.Params()...)
	if err != nil {
		return fmt.Errorf("delete invite %s: %w", id, err)
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"id": id, "deleted": true}})
}

func (h *Handler) BulkCreateInvites(c *fiber.Ctx) error {
	var body struct {
		Emails []string `json:"emails"`
		Roles  []string `json:"roles"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}

	if len(body.Emails) == 0 {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": "emails is required and must be a non-empty array"}})
	}
	if body.Roles == nil {
		body.Roles = []string{}
	}

	// Trim, lowercase, deduplicate emails
	seen := map[string]bool{}
	var emails []string
	for _, e := range body.Emails {
		e = strings.TrimSpace(strings.ToLower(e))
		if e == "" {
			return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": "emails must not contain blank entries"}})
		}
		if !seen[e] {
			seen[e] = true
			emails = append(emails, e)
		}
	}

	var invitedBy *string
	if user, ok := c.Locals("user").(*metadata.UserContext); ok && user != nil {
		invitedBy = &user.ID
	}

	expiresAt := time.Now().Add(72 * time.Hour)
	rolesParam := h.store.Dialect.ArrayParam(body.Roles)

	type createdItem struct {
		ID        string `json:"id"`
		Email     string `json:"email"`
		Token     string `json:"token"`
		ExpiresAt any    `json:"expires_at"`
	}
	type skippedItem struct {
		Email  string `json:"email"`
		Reason string `json:"reason"`
	}

	var created []createdItem
	var skipped []skippedItem

	for _, email := range emails {
		// Check email not already a user
		pb := h.store.Dialect.NewParamBuilder()
		_, err := store.QueryRow(c.Context(), h.store.DB,
			fmt.Sprintf("SELECT id FROM _users WHERE email = %s", pb.Add(email)),
			pb.Params()...)
		if err == nil {
			skipped = append(skipped, skippedItem{Email: email, Reason: "A user with this email already exists"})
			continue
		}

		// Check no pending invite
		pb2 := h.store.Dialect.NewParamBuilder()
		_, err = store.QueryRow(c.Context(), h.store.DB,
			fmt.Sprintf("SELECT id FROM _invites WHERE email = %s AND accepted_at IS NULL AND expires_at > %s",
				pb2.Add(email), h.store.Dialect.NowExpr()),
			pb2.Params()...)
		if err == nil {
			skipped = append(skipped, skippedItem{Email: email, Reason: "A pending invite already exists for this email"})
			continue
		}

		token := store.GenerateUUID()
		id := store.GenerateUUID()
		pb3 := h.store.Dialect.NewParamBuilder()
		row, err := store.QueryRow(c.Context(), h.store.DB,
			fmt.Sprintf("INSERT INTO _invites (id, email, roles, token, expires_at, invited_by) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id, email, token, expires_at",
				pb3.Add(id), pb3.Add(email), pb3.Add(rolesParam), pb3.Add(token), pb3.Add(expiresAt), pb3.Add(invitedBy)),
			pb3.Params()...)
		if err != nil {
			skipped = append(skipped, skippedItem{Email: email, Reason: fmt.Sprintf("Insert failed: %v", err)})
			continue
		}

		created = append(created, createdItem{
			ID:        fmt.Sprintf("%v", row["id"]),
			Email:     email,
			Token:     fmt.Sprintf("%v", row["token"]),
			ExpiresAt: row["expires_at"],
		})
	}

	if created == nil {
		created = []createdItem{}
	}
	if skipped == nil {
		skipped = []skippedItem{}
	}

	return c.JSON(fiber.Map{
		"data": fiber.Map{
			"created": created,
			"skipped": skipped,
			"summary": fiber.Map{
				"total":   len(emails),
				"created": len(created),
				"skipped": len(skipped),
			},
		},
	})
}

// --- Permission Endpoints ---

func (h *Handler) ListPermissions(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.DB,
		"SELECT id, entity, action, roles, conditions, created_at, updated_at FROM _permissions ORDER BY entity, action")
	if err != nil {
		return fmt.Errorf("list permissions: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	// Normalize roles from TEXT[]/JSON text to []string
	for _, row := range rows {
		row["roles"] = metadata.ParseStringArray(row["roles"])
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (h *Handler) GetPermission(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id, entity, action, roles, conditions, created_at, updated_at FROM _permissions WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Permission not found: " + id}})
	}
	row["roles"] = metadata.ParseStringArray(row["roles"])
	return c.JSON(fiber.Map{"data": row})
}

func (h *Handler) CreatePermission(c *fiber.Ctx) error {
	var perm metadata.Permission
	if err := c.BodyParser(&perm); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}

	if perm.Entity == "" {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": "entity is required"}})
	}
	if perm.Action == "" {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": "action is required"}})
	}
	validActions := map[string]bool{"read": true, "create": true, "update": true, "delete": true}
	if !validActions[perm.Action] {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": "action must be read, create, update, or delete"}})
	}
	if perm.Roles == nil {
		perm.Roles = []string{}
	}

	condJSON, err := json.Marshal(perm.Conditions)
	if err != nil {
		return fmt.Errorf("marshal conditions: %w", err)
	}

	id := store.GenerateUUID()
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("INSERT INTO _permissions (id, entity, action, roles, conditions) VALUES (%s, %s, %s, %s, %s) RETURNING id",
			pb.Add(id), pb.Add(perm.Entity), pb.Add(perm.Action), pb.Add(h.store.Dialect.ArrayParam(perm.Roles)), pb.Add(condJSON)),
		pb.Params()...)
	if err != nil {
		return fmt.Errorf("insert permission: %w", err)
	}
	perm.ID = fmt.Sprintf("%v", row["id"])

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.Status(201).JSON(fiber.Map{"data": perm})
}

func (h *Handler) UpdatePermission(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	_, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id FROM _permissions WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Permission not found: " + id}})
	}

	var perm metadata.Permission
	if err := c.BodyParser(&perm); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}
	perm.ID = id

	if perm.Entity == "" {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": "entity is required"}})
	}
	if perm.Action == "" {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": "action is required"}})
	}
	if perm.Roles == nil {
		perm.Roles = []string{}
	}

	condJSON, err := json.Marshal(perm.Conditions)
	if err != nil {
		return fmt.Errorf("marshal conditions: %w", err)
	}

	pb2 := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("UPDATE _permissions SET entity = %s, action = %s, roles = %s, conditions = %s, updated_at = %s WHERE id = %s",
			pb2.Add(perm.Entity), pb2.Add(perm.Action), pb2.Add(h.store.Dialect.ArrayParam(perm.Roles)), pb2.Add(condJSON), h.store.Dialect.NowExpr(), pb2.Add(id)),
		pb2.Params()...)
	if err != nil {
		return fmt.Errorf("update permission: %w", err)
	}

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": perm})
}

func (h *Handler) DeletePermission(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	_, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id FROM _permissions WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Permission not found: " + id}})
	}

	pb2 := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("DELETE FROM _permissions WHERE id = %s", pb2.Add(id)),
		pb2.Params()...)
	if err != nil {
		return fmt.Errorf("delete permission %s: %w", id, err)
	}

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"id": id, "deleted": true}})
}

// --- Webhook Endpoints ---

func (h *Handler) ListWebhooks(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.DB,
		"SELECT id, entity, hook, url, method, headers, condition, async, retry, active, created_at, updated_at FROM _webhooks ORDER BY entity, hook")
	if err != nil {
		return fmt.Errorf("list webhooks: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	if h.store.Dialect.NeedsBoolFix() {
		store.NormalizeBooleans(rows, []string{"active", "async"})
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (h *Handler) GetWebhook(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id, entity, hook, url, method, headers, condition, async, retry, active, created_at, updated_at FROM _webhooks WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Webhook not found: " + id}})
	}
	if h.store.Dialect.NeedsBoolFix() {
		store.NormalizeBooleans([]map[string]any{row}, []string{"active", "async"})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (h *Handler) CreateWebhook(c *fiber.Ctx) error {
	var body map[string]any
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}

	if errMsg := validateWebhook(body); errMsg != "" {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": errMsg}})
	}

	// Defaults
	if body["hook"] == nil {
		body["hook"] = "after_write"
	}
	if body["method"] == nil {
		body["method"] = "POST"
	}
	if body["async"] == nil {
		body["async"] = true
	}
	if body["active"] == nil {
		body["active"] = true
	}
	if body["headers"] == nil {
		body["headers"] = map[string]any{}
	}
	if body["condition"] == nil {
		body["condition"] = ""
	}
	if body["retry"] == nil {
		body["retry"] = map[string]any{"max_attempts": 3, "backoff": "exponential"}
	}

	headersJSON, _ := json.Marshal(body["headers"])
	retryJSON, _ := json.Marshal(body["retry"])

	id := store.GenerateUUID()
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf(`INSERT INTO _webhooks (id, entity, hook, url, method, headers, condition, async, retry, active)
		 VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
		 RETURNING id, entity, hook, url, method, headers, condition, async, retry, active, created_at, updated_at`,
			pb.Add(id), pb.Add(body["entity"]), pb.Add(body["hook"]), pb.Add(body["url"]), pb.Add(body["method"]),
			pb.Add(string(headersJSON)), pb.Add(body["condition"]), pb.Add(body["async"]), pb.Add(string(retryJSON)), pb.Add(body["active"])),
		pb.Params()...)
	if err != nil {
		return fmt.Errorf("insert webhook: %w", err)
	}

	if h.store.Dialect.NeedsBoolFix() {
		store.NormalizeBooleans([]map[string]any{row}, []string{"active", "async"})
	}

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.Status(201).JSON(fiber.Map{"data": row})
}

func (h *Handler) UpdateWebhook(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	_, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id FROM _webhooks WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Webhook not found: " + id}})
	}

	var body map[string]any
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}

	if errMsg := validateWebhook(body); errMsg != "" {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": errMsg}})
	}

	headersJSON, _ := json.Marshal(body["headers"])
	retryJSON, _ := json.Marshal(body["retry"])

	pb2 := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf(`UPDATE _webhooks SET entity = %s, hook = %s, url = %s, method = %s, headers = %s,
		 condition = %s, async = %s, retry = %s, active = %s, updated_at = %s WHERE id = %s`,
			pb2.Add(body["entity"]), pb2.Add(body["hook"]), pb2.Add(body["url"]), pb2.Add(body["method"]),
			pb2.Add(string(headersJSON)), pb2.Add(body["condition"]), pb2.Add(body["async"]), pb2.Add(string(retryJSON)), pb2.Add(body["active"]), h.store.Dialect.NowExpr(), pb2.Add(id)),
		pb2.Params()...)
	if err != nil {
		return fmt.Errorf("update webhook: %w", err)
	}

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	pb3 := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id, entity, hook, url, method, headers, condition, async, retry, active, created_at, updated_at FROM _webhooks WHERE id = %s", pb3.Add(id)),
		pb3.Params()...)
	if err != nil {
		return fmt.Errorf("fetch updated webhook: %w", err)
	}
	if h.store.Dialect.NeedsBoolFix() {
		store.NormalizeBooleans([]map[string]any{row}, []string{"active", "async"})
	}

	return c.JSON(fiber.Map{"data": row})
}

func (h *Handler) DeleteWebhook(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	_, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id FROM _webhooks WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Webhook not found: " + id}})
	}

	pb2 := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("DELETE FROM _webhooks WHERE id = %s", pb2.Add(id)),
		pb2.Params()...)
	if err != nil {
		return fmt.Errorf("delete webhook %s: %w", id, err)
	}

	if err := metadata.Reload(c.Context(), h.store.DB, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"id": id, "deleted": true}})
}

// --- Webhook Log Endpoints ---

func (h *Handler) ListWebhookLogs(c *fiber.Ctx) error {
	query := "SELECT id, webhook_id, entity, hook, url, method, request_headers, request_body, response_status, response_body, status, attempt, max_attempts, next_retry_at, error, idempotency_key, created_at, updated_at FROM _webhook_logs"
	pb := h.store.Dialect.NewParamBuilder()
	var conditions []string

	if v := c.Query("webhook_id"); v != "" {
		conditions = append(conditions, fmt.Sprintf("webhook_id = %s", pb.Add(v)))
	}
	if v := c.Query("status"); v != "" {
		conditions = append(conditions, fmt.Sprintf("status = %s", pb.Add(v)))
	}
	if v := c.Query("entity"); v != "" {
		conditions = append(conditions, fmt.Sprintf("entity = %s", pb.Add(v)))
	}

	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY created_at DESC LIMIT 200"

	rows, err := store.QueryRows(c.Context(), h.store.DB, query, pb.Params()...)
	if err != nil {
		return fmt.Errorf("list webhook logs: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (h *Handler) GetWebhookLog(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id, webhook_id, entity, hook, url, method, request_headers, request_body, response_status, response_body, status, attempt, max_attempts, next_retry_at, error, idempotency_key, created_at, updated_at FROM _webhook_logs WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Webhook log not found: " + id}})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (h *Handler) RetryWebhookLog(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id, status, attempt, max_attempts FROM _webhook_logs WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Webhook log not found: " + id}})
	}

	status, _ := row["status"].(string)
	if status != "failed" && status != "retrying" {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": "Can only retry failed or retrying webhook logs"}})
	}

	nowExpr := h.store.Dialect.NowExpr()
	pb2 := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("UPDATE _webhook_logs SET status = 'retrying', next_retry_at = %s, updated_at = %s WHERE id = %s", nowExpr, nowExpr, pb2.Add(id)),
		pb2.Params()...)
	if err != nil {
		return fmt.Errorf("retry webhook log %s: %w", id, err)
	}

	pb3 := h.store.Dialect.NewParamBuilder()
	row, err = store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id, webhook_id, entity, hook, url, method, status, attempt, max_attempts, next_retry_at, updated_at FROM _webhook_logs WHERE id = %s", pb3.Add(id)),
		pb3.Params()...)
	if err != nil {
		return fmt.Errorf("fetch retried webhook log: %w", err)
	}

	return c.JSON(fiber.Map{"data": row})
}

func validateWebhook(body map[string]any) string {
	entity, _ := body["entity"].(string)
	if entity == "" {
		return "entity is required"
	}

	hook, _ := body["hook"].(string)
	if hook != "" {
		validHooks := map[string]bool{"after_write": true, "before_write": true, "after_delete": true, "before_delete": true}
		if !validHooks[hook] {
			return "hook must be after_write, before_write, after_delete, or before_delete"
		}
	}

	url, _ := body["url"].(string)
	if url == "" {
		return "url is required"
	}
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		return "url must start with http:// or https://"
	}

	method, _ := body["method"].(string)
	if method != "" {
		validMethods := map[string]bool{"POST": true, "PUT": true, "PATCH": true, "GET": true, "DELETE": true}
		if !validMethods[method] {
			return "method must be POST, PUT, PATCH, GET, or DELETE"
		}
	}

	return ""
}

// --- UI Config Endpoints ---

func (h *Handler) ListUIConfigs(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.DB,
		"SELECT id, entity, scope, config, created_at, updated_at FROM _ui_configs ORDER BY entity, scope")
	if err != nil {
		return fmt.Errorf("list ui configs: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (h *Handler) GetUIConfig(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id, entity, scope, config, created_at, updated_at FROM _ui_configs WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "UI config not found: " + id}})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (h *Handler) CreateUIConfig(c *fiber.Ctx) error {
	var body map[string]any
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}

	entity, _ := body["entity"].(string)
	if entity == "" {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": "entity is required"}})
	}

	// Verify entity exists (skip for reserved names like _app)
	if !strings.HasPrefix(entity, "_") {
		pbCheck := h.store.Dialect.NewParamBuilder()
		_, err := store.QueryRow(c.Context(), h.store.DB,
			fmt.Sprintf("SELECT name FROM _entities WHERE name = %s", pbCheck.Add(entity)),
			pbCheck.Params()...)
		if err != nil {
			return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": "entity not found: " + entity}})
		}
	}

	scope, _ := body["scope"].(string)
	if scope == "" {
		scope = "default"
	}

	config := body["config"]
	if config == nil {
		config = map[string]any{}
	}
	configJSON, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}

	id := store.GenerateUUID()
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("INSERT INTO _ui_configs (id, entity, scope, config) VALUES (%s, %s, %s, %s) RETURNING id, entity, scope, config, created_at, updated_at",
			pb.Add(id), pb.Add(entity), pb.Add(scope), pb.Add(configJSON)),
		pb.Params()...)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "UNIQUE") {
			return c.Status(409).JSON(fiber.Map{"error": fiber.Map{"code": "CONFLICT", "message": fmt.Sprintf("UI config already exists for entity %s scope %s", entity, scope)}})
		}
		return fmt.Errorf("insert ui config: %w", err)
	}

	return c.Status(201).JSON(fiber.Map{"data": row})
}

func (h *Handler) UpdateUIConfig(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	_, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id FROM _ui_configs WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "UI config not found: " + id}})
	}

	var body map[string]any
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}

	entity, _ := body["entity"].(string)
	if entity == "" {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": "entity is required"}})
	}

	scope, _ := body["scope"].(string)
	if scope == "" {
		scope = "default"
	}

	config := body["config"]
	if config == nil {
		config = map[string]any{}
	}
	configJSON, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}

	pb2 := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("UPDATE _ui_configs SET entity = %s, scope = %s, config = %s, updated_at = %s WHERE id = %s RETURNING id, entity, scope, config, created_at, updated_at",
			pb2.Add(entity), pb2.Add(scope), pb2.Add(configJSON), h.store.Dialect.NowExpr(), pb2.Add(id)),
		pb2.Params()...)
	if err != nil {
		return fmt.Errorf("update ui config: %w", err)
	}

	return c.JSON(fiber.Map{"data": row})
}

func (h *Handler) DeleteUIConfig(c *fiber.Ctx) error {
	id := c.Params("id")
	pb := h.store.Dialect.NewParamBuilder()
	_, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id FROM _ui_configs WHERE id = %s", pb.Add(id)),
		pb.Params()...)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "UI config not found: " + id}})
	}

	pb2 := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("DELETE FROM _ui_configs WHERE id = %s", pb2.Add(id)),
		pb2.Params()...)
	if err != nil {
		return fmt.Errorf("delete ui config %s: %w", id, err)
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"id": id, "deleted": true}})
}

// GetUIConfigByEntity returns the default-scope UI config for an entity (non-admin endpoint).
func (h *Handler) GetUIConfigByEntity(c *fiber.Ctx) error {
	entity := c.Params("entity")
	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT id, entity, scope, config, created_at, updated_at FROM _ui_configs WHERE entity = %s AND scope = 'default'", pb.Add(entity)),
		pb.Params()...)
	if err != nil {
		return c.JSON(fiber.Map{"data": nil})
	}
	return c.JSON(fiber.Map{"data": row})
}

// ListAllUIConfigs returns all UI configs (non-admin endpoint for client sidebar grouping).
func (h *Handler) ListAllUIConfigs(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.DB,
		"SELECT id, entity, scope, config, created_at, updated_at FROM _ui_configs WHERE scope = 'default' ORDER BY entity")
	if err != nil {
		return fmt.Errorf("list all ui configs: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	return c.JSON(fiber.Map{"data": rows})
}

// --- Export/Import Endpoints ---

func (h *Handler) Export(c *fiber.Ctx) error {
	ctx := c.Context()

	// Entities: definition column IS the full entity object
	entityRows, err := store.QueryRows(ctx, h.store.DB,
		"SELECT definition FROM _entities ORDER BY name")
	if err != nil {
		return fmt.Errorf("export entities: %w", err)
	}
	entities := make([]any, 0, len(entityRows))
	for _, row := range entityRows {
		entities = append(entities, row["definition"])
	}

	// Relations: definition column IS the full relation object
	relRows, err := store.QueryRows(ctx, h.store.DB,
		"SELECT definition FROM _relations ORDER BY name")
	if err != nil {
		return fmt.Errorf("export relations: %w", err)
	}
	relations := make([]any, 0, len(relRows))
	for _, row := range relRows {
		relations = append(relations, row["definition"])
	}

	// Rules
	ruleRows, err := store.QueryRows(ctx, h.store.DB,
		"SELECT entity, hook, type, definition, priority, active FROM _rules ORDER BY entity, priority")
	if err != nil {
		return fmt.Errorf("export rules: %w", err)
	}
	if h.store.Dialect.NeedsBoolFix() {
		store.NormalizeBooleans(ruleRows, []string{"active"})
	}
	rules := make([]map[string]any, 0, len(ruleRows))
	for _, row := range ruleRows {
		rules = append(rules, map[string]any{
			"entity": row["entity"], "hook": row["hook"], "type": row["type"],
			"definition": row["definition"], "priority": row["priority"], "active": row["active"],
		})
	}

	// State machines
	smRows, err := store.QueryRows(ctx, h.store.DB,
		"SELECT entity, field, definition, active FROM _state_machines ORDER BY entity")
	if err != nil {
		return fmt.Errorf("export state machines: %w", err)
	}
	if h.store.Dialect.NeedsBoolFix() {
		store.NormalizeBooleans(smRows, []string{"active"})
	}
	stateMachines := make([]map[string]any, 0, len(smRows))
	for _, row := range smRows {
		stateMachines = append(stateMachines, map[string]any{
			"entity": row["entity"], "field": row["field"],
			"definition": row["definition"], "active": row["active"],
		})
	}

	// Workflows
	wfRows, err := store.QueryRows(ctx, h.store.DB,
		"SELECT name, trigger, context, steps, active FROM _workflows ORDER BY name")
	if err != nil {
		return fmt.Errorf("export workflows: %w", err)
	}
	if h.store.Dialect.NeedsBoolFix() {
		store.NormalizeBooleans(wfRows, []string{"active"})
	}
	workflows := make([]map[string]any, 0, len(wfRows))
	for _, row := range wfRows {
		workflows = append(workflows, map[string]any{
			"name": row["name"], "trigger": row["trigger"],
			"context": row["context"], "steps": row["steps"], "active": row["active"],
		})
	}

	// Permissions
	permRows, err := store.QueryRows(ctx, h.store.DB,
		"SELECT entity, action, roles, conditions FROM _permissions ORDER BY entity, action")
	if err != nil {
		return fmt.Errorf("export permissions: %w", err)
	}
	permissions := make([]map[string]any, 0, len(permRows))
	for _, row := range permRows {
		permissions = append(permissions, map[string]any{
			"entity": row["entity"], "action": row["action"],
			"roles": metadata.ParseStringArray(row["roles"]), "conditions": row["conditions"],
		})
	}

	// Webhooks
	whRows, err := store.QueryRows(ctx, h.store.DB,
		"SELECT entity, hook, url, method, headers, condition, async, retry, active FROM _webhooks ORDER BY entity, hook")
	if err != nil {
		return fmt.Errorf("export webhooks: %w", err)
	}
	if h.store.Dialect.NeedsBoolFix() {
		store.NormalizeBooleans(whRows, []string{"active", "async"})
	}
	webhooks := make([]map[string]any, 0, len(whRows))
	for _, row := range whRows {
		webhooks = append(webhooks, map[string]any{
			"entity": row["entity"], "hook": row["hook"], "url": row["url"],
			"method": row["method"], "headers": row["headers"], "condition": row["condition"],
			"async": row["async"], "retry": row["retry"], "active": row["active"],
		})
	}

	// UI Configs
	uiRows, err := store.QueryRows(ctx, h.store.DB,
		"SELECT entity, scope, config FROM _ui_configs ORDER BY entity, scope")
	if err != nil {
		return fmt.Errorf("export ui configs: %w", err)
	}
	uiConfigs := make([]map[string]any, 0, len(uiRows))
	for _, row := range uiRows {
		uiConfigs = append(uiConfigs, map[string]any{
			"entity": row["entity"], "scope": row["scope"], "config": row["config"],
		})
	}

	return c.JSON(fiber.Map{"data": fiber.Map{
		"version":        1,
		"exported_at":    time.Now().UTC().Format(time.RFC3339),
		"entities":       entities,
		"relations":      relations,
		"rules":          rules,
		"state_machines": stateMachines,
		"workflows":      workflows,
		"permissions":    permissions,
		"webhooks":       webhooks,
		"ui_configs":     uiConfigs,
	}})
}

func (h *Handler) Import(c *fiber.Ctx) error {
	var payload struct {
		Version       int                         `json:"version"`
		Entities      []map[string]any            `json:"entities"`
		Relations     []map[string]any            `json:"relations"`
		Rules         []map[string]any            `json:"rules"`
		StateMachines []map[string]any            `json:"state_machines"`
		Workflows     []map[string]any            `json:"workflows"`
		Permissions   []map[string]any            `json:"permissions"`
		Webhooks      []map[string]any            `json:"webhooks"`
		UIConfigs     []map[string]any            `json:"ui_configs"`
		SampleData    map[string][]map[string]any `json:"sample_data"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}
	if payload.Version != 1 {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED",
			"message": fmt.Sprintf("Unsupported export version: %d", payload.Version)}})
	}

	ctx := c.Context()
	summary := map[string]int{
		"entities": 0, "relations": 0, "rules": 0,
		"state_machines": 0, "workflows": 0,
		"permissions": 0, "webhooks": 0,
	}
	var errors []string

	// Step 1: Entities
	for _, raw := range payload.Entities {
		name, _ := raw["name"].(string)
		table, _ := raw["table"].(string)
		if name == "" || table == "" {
			continue
		}
		if h.registry.GetEntity(name) != nil {
			continue
		}
		defJSON, err := json.Marshal(raw)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Entity %s: %v", name, err))
			continue
		}
		pb := h.store.Dialect.NewParamBuilder()
		_, err = store.Exec(ctx, h.store.DB,
			fmt.Sprintf("INSERT INTO _entities (name, table_name, definition) VALUES (%s, %s, %s)",
				pb.Add(name), pb.Add(table), pb.Add(defJSON)),
			pb.Params()...)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Entity %s: %v", name, err))
			continue
		}
		// Migrate: create the business table
		var entity metadata.Entity
		if err := json.Unmarshal(defJSON, &entity); err == nil {
			_ = h.migrator.Migrate(ctx, &entity)
		}
		summary["entities"]++
	}

	// Reload so relations can reference the new entities
	_ = metadata.Reload(ctx, h.store.DB, h.registry)

	// Step 2: Relations
	for _, raw := range payload.Relations {
		name, _ := raw["name"].(string)
		source, _ := raw["source"].(string)
		target, _ := raw["target"].(string)
		if name == "" {
			continue
		}
		if h.registry.GetRelation(name) != nil {
			continue
		}
		defJSON, err := json.Marshal(raw)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Relation %s: %v", name, err))
			continue
		}
		pb := h.store.Dialect.NewParamBuilder()
		_, err = store.Exec(ctx, h.store.DB,
			fmt.Sprintf("INSERT INTO _relations (name, source, target, definition) VALUES (%s, %s, %s, %s)",
				pb.Add(name), pb.Add(source), pb.Add(target), pb.Add(defJSON)),
			pb.Params()...)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Relation %s: %v", name, err))
			continue
		}
		// Create join table for many-to-many
		var rel metadata.Relation
		if err := json.Unmarshal(defJSON, &rel); err == nil && rel.IsManyToMany() {
			src := h.registry.GetEntity(rel.Source)
			tgt := h.registry.GetEntity(rel.Target)
			if src != nil && tgt != nil {
				_ = h.migrator.MigrateJoinTable(ctx, &rel, src, tgt)
			}
		}
		summary["relations"]++
	}

	// Step 3: Rules (dedup by entity+hook+type+definition)
	existingRules, _ := store.QueryRows(ctx, h.store.DB,
		"SELECT entity, hook, type, definition FROM _rules")
	ruleSet := make(map[string]bool)
	for _, r := range existingRules {
		defJSON, _ := json.Marshal(r["definition"])
		key := fmt.Sprintf("%v|%v|%v|%s", r["entity"], r["hook"], r["type"], defJSON)
		ruleSet[key] = true
	}
	for _, raw := range payload.Rules {
		defJSON, _ := json.Marshal(raw["definition"])
		key := fmt.Sprintf("%v|%v|%v|%s", raw["entity"], raw["hook"], raw["type"], defJSON)
		if ruleSet[key] {
			continue
		}
		id := store.GenerateUUID()
		pb := h.store.Dialect.NewParamBuilder()
		_, err := store.QueryRow(ctx, h.store.DB,
			fmt.Sprintf("INSERT INTO _rules (id, entity, hook, type, definition, priority, active) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
				pb.Add(id), pb.Add(raw["entity"]), pb.Add(raw["hook"]), pb.Add(raw["type"]), pb.Add(defJSON), pb.Add(raw["priority"]), pb.Add(raw["active"])),
			pb.Params()...)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Rule (%v/%v): %v", raw["entity"], raw["hook"], err))
			continue
		}
		ruleSet[key] = true
		summary["rules"]++
	}

	// Step 4: State machines (dedup by entity+field)
	existingSMs, _ := store.QueryRows(ctx, h.store.DB,
		"SELECT entity, field FROM _state_machines")
	smSet := make(map[string]bool)
	for _, r := range existingSMs {
		smSet[fmt.Sprintf("%v|%v", r["entity"], r["field"])] = true
	}
	for _, raw := range payload.StateMachines {
		key := fmt.Sprintf("%v|%v", raw["entity"], raw["field"])
		if smSet[key] {
			continue
		}
		defJSON, _ := json.Marshal(raw["definition"])
		id := store.GenerateUUID()
		pb := h.store.Dialect.NewParamBuilder()
		_, err := store.QueryRow(ctx, h.store.DB,
			fmt.Sprintf("INSERT INTO _state_machines (id, entity, field, definition, active) VALUES (%s, %s, %s, %s, %s) RETURNING id",
				pb.Add(id), pb.Add(raw["entity"]), pb.Add(raw["field"]), pb.Add(defJSON), pb.Add(raw["active"])),
			pb.Params()...)
		if err != nil {
			errors = append(errors, fmt.Sprintf("State machine (%v/%v): %v", raw["entity"], raw["field"], err))
			continue
		}
		smSet[key] = true
		summary["state_machines"]++
	}

	// Step 5: Workflows (dedup by name)
	for _, raw := range payload.Workflows {
		name, _ := raw["name"].(string)
		if name == "" {
			continue
		}
		pbCheck := h.store.Dialect.NewParamBuilder()
		_, err := store.QueryRow(ctx, h.store.DB,
			fmt.Sprintf("SELECT id FROM _workflows WHERE name = %s", pbCheck.Add(name)),
			pbCheck.Params()...)
		if err == nil {
			continue // already exists
		}
		triggerJSON, _ := json.Marshal(raw["trigger"])
		contextJSON, _ := json.Marshal(raw["context"])
		stepsJSON, _ := json.Marshal(raw["steps"])
		id := store.GenerateUUID()
		pb := h.store.Dialect.NewParamBuilder()
		_, err = store.QueryRow(ctx, h.store.DB,
			fmt.Sprintf("INSERT INTO _workflows (id, name, trigger, context, steps, active) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
				pb.Add(id), pb.Add(name), pb.Add(triggerJSON), pb.Add(contextJSON), pb.Add(stepsJSON), pb.Add(raw["active"])),
			pb.Params()...)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Workflow %s: %v", name, err))
			continue
		}
		summary["workflows"]++
	}

	// Step 6: Permissions (dedup by entity+action)
	existingPerms, _ := store.QueryRows(ctx, h.store.DB,
		"SELECT entity, action FROM _permissions")
	permSet := make(map[string]bool)
	for _, r := range existingPerms {
		permSet[fmt.Sprintf("%v|%v", r["entity"], r["action"])] = true
	}
	for _, raw := range payload.Permissions {
		key := fmt.Sprintf("%v|%v", raw["entity"], raw["action"])
		if permSet[key] {
			continue
		}
		condJSON, _ := json.Marshal(raw["conditions"])
		// Convert roles from any to []string for ArrayParam
		rolesRaw := metadata.ParseStringArray(raw["roles"])
		id := store.GenerateUUID()
		pb := h.store.Dialect.NewParamBuilder()
		_, err := store.QueryRow(ctx, h.store.DB,
			fmt.Sprintf("INSERT INTO _permissions (id, entity, action, roles, conditions) VALUES (%s, %s, %s, %s, %s) RETURNING id",
				pb.Add(id), pb.Add(raw["entity"]), pb.Add(raw["action"]), pb.Add(h.store.Dialect.ArrayParam(rolesRaw)), pb.Add(condJSON)),
			pb.Params()...)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Permission (%v/%v): %v", raw["entity"], raw["action"], err))
			continue
		}
		permSet[key] = true
		summary["permissions"]++
	}

	// Step 7: Webhooks (dedup by entity+hook+url)
	existingWHs, _ := store.QueryRows(ctx, h.store.DB,
		"SELECT entity, hook, url FROM _webhooks")
	whSet := make(map[string]bool)
	for _, r := range existingWHs {
		whSet[fmt.Sprintf("%v|%v|%v", r["entity"], r["hook"], r["url"])] = true
	}
	for _, raw := range payload.Webhooks {
		key := fmt.Sprintf("%v|%v|%v", raw["entity"], raw["hook"], raw["url"])
		if whSet[key] {
			continue
		}
		headersJSON, _ := json.Marshal(raw["headers"])
		retryJSON, _ := json.Marshal(raw["retry"])
		method := raw["method"]
		if method == nil {
			method = "POST"
		}
		hook := raw["hook"]
		if hook == nil {
			hook = "after_write"
		}
		async := raw["async"]
		if async == nil {
			async = true
		}
		active := raw["active"]
		if active == nil {
			active = true
		}
		condition := raw["condition"]
		if condition == nil {
			condition = ""
		}
		id := store.GenerateUUID()
		pb := h.store.Dialect.NewParamBuilder()
		_, err := store.QueryRow(ctx, h.store.DB,
			fmt.Sprintf(`INSERT INTO _webhooks (id, entity, hook, url, method, headers, condition, async, retry, active)
			 VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id`,
				pb.Add(id), pb.Add(raw["entity"]), pb.Add(hook), pb.Add(raw["url"]), pb.Add(method),
				pb.Add(string(headersJSON)), pb.Add(condition), pb.Add(async), pb.Add(string(retryJSON)), pb.Add(active)),
			pb.Params()...)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Webhook (%v/%v/%v): %v", raw["entity"], raw["hook"], raw["url"], err))
			continue
		}
		whSet[key] = true
		summary["webhooks"]++
	}

	// Step 8: UI Configs (upsert by entity+scope)
	summary["ui_configs"] = 0
	for _, raw := range payload.UIConfigs {
		entity, _ := raw["entity"].(string)
		scope, _ := raw["scope"].(string)
		if entity == "" {
			continue
		}
		if scope == "" {
			scope = "default"
		}
		configJSON, _ := json.Marshal(raw["config"])
		id := store.GenerateUUID()
		pb := h.store.Dialect.NewParamBuilder()
		_, err := store.QueryRow(ctx, h.store.DB,
			fmt.Sprintf(`INSERT INTO _ui_configs (id, entity, scope, config) VALUES (%s, %s, %s, %s)
			 ON CONFLICT (entity, scope) DO UPDATE SET config = EXCLUDED.config, updated_at = %s
			 RETURNING id`,
				pb.Add(id), pb.Add(entity), pb.Add(scope), pb.Add(configJSON), h.store.Dialect.NowExpr()),
			pb.Params()...)
		if err != nil {
			errors = append(errors, fmt.Sprintf("UI config (%v/%v): %v", entity, scope, err))
			continue
		}
		summary["ui_configs"]++
	}

	// Final reload
	_ = metadata.Reload(ctx, h.store.DB, h.registry)

	// Step 9: Sample data (insert records into business tables)
	if len(payload.SampleData) > 0 {
		summary["records"] = 0

		// Process entity records in definition order
		for _, entRaw := range payload.Entities {
			name, _ := entRaw["name"].(string)
			entity := h.registry.GetEntity(name)
			if entity == nil {
				continue
			}
			records, ok := payload.SampleData[name]
			if !ok || len(records) == 0 {
				continue
			}
			// Build field type map from entity definition
			fieldTypes := make(map[string]string)
			for _, f := range entity.Fields {
				fieldTypes[f.Name] = f.Type
			}
			for _, record := range records {
				pb := h.store.Dialect.NewParamBuilder()
				cols := make([]string, 0, len(record))
				placeholders := make([]string, 0, len(record))
				for key, val := range record {
					ft, ok := fieldTypes[key]
					if !ok {
						continue
					}
					// Convert JSON float64 to proper Go types
					if v, isFloat := val.(float64); isFloat {
						switch ft {
						case "integer", "int", "bigint":
							val = int64(v)
						}
					}
					cols = append(cols, `"`+key+`"`)
					placeholders = append(placeholders, pb.Add(val))
				}
				if len(cols) == 0 {
					continue
				}
				query := fmt.Sprintf(
					`INSERT INTO %q (%s) VALUES (%s) ON CONFLICT DO NOTHING`,
					entity.Table, strings.Join(cols, ", "), strings.Join(placeholders, ", "),
				)
				_, err := store.Exec(ctx, h.store.DB, query, pb.Params()...)
				if err != nil {
					errors = append(errors, fmt.Sprintf("Record %s: %v", name, err))
					continue
				}
				summary["records"]++
			}
		}

		// Process join table data (keys that don't match entity names)
		for key, records := range payload.SampleData {
			if h.registry.GetEntity(key) != nil {
				continue // already processed above
			}
			if len(records) == 0 {
				continue
			}
			// Find matching join table from payload relations
			tableName := ""
			var validCols map[string]bool
			for _, rel := range payload.Relations {
				jt, _ := rel["join_table"].(string)
				if jt == key {
					tableName = key
					sjk, _ := rel["source_join_key"].(string)
					tjk, _ := rel["target_join_key"].(string)
					validCols = map[string]bool{sjk: true, tjk: true}
					break
				}
			}
			if tableName == "" {
				continue
			}
			for _, record := range records {
				pb := h.store.Dialect.NewParamBuilder()
				cols := make([]string, 0, len(record))
				placeholders := make([]string, 0, len(record))
				for k, v := range record {
					if !validCols[k] {
						continue
					}
					cols = append(cols, `"`+k+`"`)
					placeholders = append(placeholders, pb.Add(v))
				}
				if len(cols) == 0 {
					continue
				}
				query := fmt.Sprintf(
					`INSERT INTO %q (%s) VALUES (%s) ON CONFLICT DO NOTHING`,
					tableName, strings.Join(cols, ", "), strings.Join(placeholders, ", "),
				)
				_, err := store.Exec(ctx, h.store.DB, query, pb.Params()...)
				if err != nil {
					errors = append(errors, fmt.Sprintf("Record %s: %v", key, err))
					continue
				}
				summary["records"]++
			}
		}
	}

	result := fiber.Map{
		"message": "Import completed",
		"summary": summary,
	}
	if len(errors) > 0 {
		result["errors"] = errors
	}
	return c.JSON(fiber.Map{"data": result})
}

func validateRelation(r *metadata.Relation, reg *metadata.Registry) error {
	if r.Name == "" {
		return fmt.Errorf("relation name is required")
	}
	if r.Source == "" || r.Target == "" {
		return fmt.Errorf("source and target are required")
	}
	if reg.GetEntity(r.Source) == nil {
		return fmt.Errorf("source entity not found: %s", r.Source)
	}
	if reg.GetEntity(r.Target) == nil {
		return fmt.Errorf("target entity not found: %s", r.Target)
	}
	if r.Type != "one_to_one" && r.Type != "one_to_many" && r.Type != "many_to_many" {
		return fmt.Errorf("invalid relation type: %s", r.Type)
	}
	if r.IsManyToMany() && r.JoinTable == "" {
		return fmt.Errorf("join_table is required for many_to_many relations")
	}
	return nil
}
