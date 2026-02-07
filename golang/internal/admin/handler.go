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

	admin.Get("/export", h.Export)
	admin.Post("/import", h.Import)
}

// --- Entity Endpoints ---

func (h *Handler) ListEntities(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.Pool,
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
	row, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT name, table_name, definition, created_at, updated_at FROM _entities WHERE name = $1", name)
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

	_, err = store.Exec(c.Context(), h.store.Pool,
		"INSERT INTO _entities (name, table_name, definition) VALUES ($1, $2, $3)",
		entity.Name, entity.Table, defJSON)
	if err != nil {
		return fmt.Errorf("insert entity: %w", err)
	}

	// Auto-migrate: create the table
	if err := h.migrator.Migrate(c.Context(), &entity); err != nil {
		return fmt.Errorf("migrate entity %s: %w", entity.Name, err)
	}

	// Reload registry
	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
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

	_, err = store.Exec(c.Context(), h.store.Pool,
		"UPDATE _entities SET table_name = $1, definition = $2, updated_at = NOW() WHERE name = $3",
		entity.Table, defJSON, name)
	if err != nil {
		return fmt.Errorf("update entity: %w", err)
	}

	if err := h.migrator.Migrate(c.Context(), &entity); err != nil {
		return fmt.Errorf("migrate entity %s: %w", entity.Name, err)
	}

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
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
	_, err := store.Exec(c.Context(), h.store.Pool,
		"DELETE FROM _relations WHERE source = $1 OR target = $1", name)
	if err != nil {
		return fmt.Errorf("delete relations for entity %s: %w", name, err)
	}

	_, err = store.Exec(c.Context(), h.store.Pool,
		"DELETE FROM _entities WHERE name = $1", name)
	if err != nil {
		return fmt.Errorf("delete entity %s: %w", name, err)
	}

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"name": name, "deleted": true}})
}

// --- Relation Endpoints ---

func (h *Handler) ListRelations(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.Pool,
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
	row, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT name, source, target, definition, created_at, updated_at FROM _relations WHERE name = $1", name)
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

	_, err = store.Exec(c.Context(), h.store.Pool,
		"INSERT INTO _relations (name, source, target, definition) VALUES ($1, $2, $3, $4)",
		rel.Name, rel.Source, rel.Target, defJSON)
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

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
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

	_, err = store.Exec(c.Context(), h.store.Pool,
		"UPDATE _relations SET source = $1, target = $2, definition = $3, updated_at = NOW() WHERE name = $4",
		rel.Source, rel.Target, defJSON, name)
	if err != nil {
		return fmt.Errorf("update relation: %w", err)
	}

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
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

	_, err := store.Exec(c.Context(), h.store.Pool,
		"DELETE FROM _relations WHERE name = $1", name)
	if err != nil {
		return fmt.Errorf("delete relation %s: %w", name, err)
	}

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"name": name, "deleted": true}})
}

// --- Rule Endpoints ---

func (h *Handler) ListRules(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.Pool,
		"SELECT id, entity, hook, type, definition, priority, active, created_at, updated_at FROM _rules ORDER BY entity, priority")
	if err != nil {
		return fmt.Errorf("list rules: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (h *Handler) GetRule(c *fiber.Ctx) error {
	id := c.Params("id")
	row, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id, entity, hook, type, definition, priority, active, created_at, updated_at FROM _rules WHERE id = $1", id)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Rule not found: " + id}})
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

	row, err := store.QueryRow(c.Context(), h.store.Pool,
		"INSERT INTO _rules (entity, hook, type, definition, priority, active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
		rule.Entity, rule.Hook, rule.Type, defJSON, rule.Priority, rule.Active)
	if err != nil {
		return fmt.Errorf("insert rule: %w", err)
	}
	rule.ID = fmt.Sprintf("%v", row["id"])

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.Status(201).JSON(fiber.Map{"data": rule})
}

func (h *Handler) UpdateRule(c *fiber.Ctx) error {
	id := c.Params("id")
	_, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id FROM _rules WHERE id = $1", id)
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

	_, err = store.Exec(c.Context(), h.store.Pool,
		"UPDATE _rules SET entity = $1, hook = $2, type = $3, definition = $4, priority = $5, active = $6, updated_at = NOW() WHERE id = $7",
		rule.Entity, rule.Hook, rule.Type, defJSON, rule.Priority, rule.Active, id)
	if err != nil {
		return fmt.Errorf("update rule: %w", err)
	}

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": rule})
}

func (h *Handler) DeleteRule(c *fiber.Ctx) error {
	id := c.Params("id")
	_, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id FROM _rules WHERE id = $1", id)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Rule not found: " + id}})
	}

	_, err = store.Exec(c.Context(), h.store.Pool,
		"DELETE FROM _rules WHERE id = $1", id)
	if err != nil {
		return fmt.Errorf("delete rule %s: %w", id, err)
	}

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"id": id, "deleted": true}})
}

// --- State Machine Endpoints ---

func (h *Handler) ListStateMachines(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.Pool,
		"SELECT id, entity, field, definition, active, created_at, updated_at FROM _state_machines ORDER BY entity")
	if err != nil {
		return fmt.Errorf("list state machines: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (h *Handler) GetStateMachine(c *fiber.Ctx) error {
	id := c.Params("id")
	row, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id, entity, field, definition, active, created_at, updated_at FROM _state_machines WHERE id = $1", id)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "State machine not found: " + id}})
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

	row, err := store.QueryRow(c.Context(), h.store.Pool,
		"INSERT INTO _state_machines (entity, field, definition, active) VALUES ($1, $2, $3, $4) RETURNING id",
		sm.Entity, sm.Field, defJSON, sm.Active)
	if err != nil {
		return fmt.Errorf("insert state machine: %w", err)
	}
	sm.ID = fmt.Sprintf("%v", row["id"])

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.Status(201).JSON(fiber.Map{"data": sm})
}

func (h *Handler) UpdateStateMachine(c *fiber.Ctx) error {
	id := c.Params("id")
	_, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id FROM _state_machines WHERE id = $1", id)
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

	_, err = store.Exec(c.Context(), h.store.Pool,
		"UPDATE _state_machines SET entity = $1, field = $2, definition = $3, active = $4, updated_at = NOW() WHERE id = $5",
		sm.Entity, sm.Field, defJSON, sm.Active, id)
	if err != nil {
		return fmt.Errorf("update state machine: %w", err)
	}

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": sm})
}

func (h *Handler) DeleteStateMachine(c *fiber.Ctx) error {
	id := c.Params("id")
	_, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id FROM _state_machines WHERE id = $1", id)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "State machine not found: " + id}})
	}

	_, err = store.Exec(c.Context(), h.store.Pool,
		"DELETE FROM _state_machines WHERE id = $1", id)
	if err != nil {
		return fmt.Errorf("delete state machine %s: %w", id, err)
	}

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"id": id, "deleted": true}})
}

// --- Workflow Endpoints ---

func (h *Handler) ListWorkflows(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.Pool,
		"SELECT id, name, trigger, context, steps, active, created_at, updated_at FROM _workflows ORDER BY name")
	if err != nil {
		return fmt.Errorf("list workflows: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (h *Handler) GetWorkflow(c *fiber.Ctx) error {
	id := c.Params("id")
	row, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id, name, trigger, context, steps, active, created_at, updated_at FROM _workflows WHERE id = $1", id)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Workflow not found: " + id}})
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

	row, err := store.QueryRow(c.Context(), h.store.Pool,
		"INSERT INTO _workflows (name, trigger, context, steps, active) VALUES ($1, $2, $3, $4, $5) RETURNING id",
		wf.Name, triggerJSON, contextJSON, stepsJSON, wf.Active)
	if err != nil {
		return fmt.Errorf("insert workflow: %w", err)
	}
	wf.ID = fmt.Sprintf("%v", row["id"])

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.Status(201).JSON(fiber.Map{"data": wf})
}

func (h *Handler) UpdateWorkflow(c *fiber.Ctx) error {
	id := c.Params("id")
	_, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id FROM _workflows WHERE id = $1", id)
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

	_, err = store.Exec(c.Context(), h.store.Pool,
		"UPDATE _workflows SET name = $1, trigger = $2, context = $3, steps = $4, active = $5, updated_at = NOW() WHERE id = $6",
		wf.Name, triggerJSON, contextJSON, stepsJSON, wf.Active, id)
	if err != nil {
		return fmt.Errorf("update workflow: %w", err)
	}

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": wf})
}

func (h *Handler) DeleteWorkflow(c *fiber.Ctx) error {
	id := c.Params("id")
	_, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id FROM _workflows WHERE id = $1", id)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Workflow not found: " + id}})
	}

	_, err = store.Exec(c.Context(), h.store.Pool,
		"DELETE FROM _workflows WHERE id = $1", id)
	if err != nil {
		return fmt.Errorf("delete workflow %s: %w", id, err)
	}

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
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
	rows, err := store.QueryRows(c.Context(), h.store.Pool,
		"SELECT id, email, roles, active, created_at, updated_at FROM _users ORDER BY email")
	if err != nil {
		return fmt.Errorf("list users: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (h *Handler) GetUser(c *fiber.Ctx) error {
	id := c.Params("id")
	row, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id, email, roles, active, created_at, updated_at FROM _users WHERE id = $1", id)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "User not found: " + id}})
	}
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

	row, err := store.QueryRow(c.Context(), h.store.Pool,
		"INSERT INTO _users (email, password_hash, roles, active) VALUES ($1, $2, $3, $4) RETURNING id, email, roles, active, created_at, updated_at",
		body.Email, hash, body.Roles, active)
	if err != nil {
		return fmt.Errorf("insert user: %w", err)
	}

	return c.Status(201).JSON(fiber.Map{"data": row})
}

func (h *Handler) UpdateUser(c *fiber.Ctx) error {
	id := c.Params("id")
	_, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id FROM _users WHERE id = $1", id)
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
		_, err = store.Exec(c.Context(), h.store.Pool,
			"UPDATE _users SET email = $1, password_hash = $2, roles = $3, active = $4, updated_at = NOW() WHERE id = $5",
			body.Email, hash, body.Roles, body.Active, id)
		if err != nil {
			return fmt.Errorf("update user: %w", err)
		}
	} else {
		_, err = store.Exec(c.Context(), h.store.Pool,
			"UPDATE _users SET email = $1, roles = $2, active = $3, updated_at = NOW() WHERE id = $4",
			body.Email, body.Roles, body.Active, id)
		if err != nil {
			return fmt.Errorf("update user: %w", err)
		}
	}

	row, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id, email, roles, active, created_at, updated_at FROM _users WHERE id = $1", id)
	if err != nil {
		return fmt.Errorf("fetch updated user: %w", err)
	}

	return c.JSON(fiber.Map{"data": row})
}

func (h *Handler) DeleteUser(c *fiber.Ctx) error {
	id := c.Params("id")
	_, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id FROM _users WHERE id = $1", id)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "User not found: " + id}})
	}

	_, err = store.Exec(c.Context(), h.store.Pool,
		"DELETE FROM _users WHERE id = $1", id)
	if err != nil {
		return fmt.Errorf("delete user %s: %w", id, err)
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"id": id, "deleted": true}})
}

// --- Permission Endpoints ---

func (h *Handler) ListPermissions(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.Pool,
		"SELECT id, entity, action, roles, conditions, created_at, updated_at FROM _permissions ORDER BY entity, action")
	if err != nil {
		return fmt.Errorf("list permissions: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (h *Handler) GetPermission(c *fiber.Ctx) error {
	id := c.Params("id")
	row, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id, entity, action, roles, conditions, created_at, updated_at FROM _permissions WHERE id = $1", id)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Permission not found: " + id}})
	}
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

	row, err := store.QueryRow(c.Context(), h.store.Pool,
		"INSERT INTO _permissions (entity, action, roles, conditions) VALUES ($1, $2, $3, $4) RETURNING id",
		perm.Entity, perm.Action, perm.Roles, condJSON)
	if err != nil {
		return fmt.Errorf("insert permission: %w", err)
	}
	perm.ID = fmt.Sprintf("%v", row["id"])

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.Status(201).JSON(fiber.Map{"data": perm})
}

func (h *Handler) UpdatePermission(c *fiber.Ctx) error {
	id := c.Params("id")
	_, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id FROM _permissions WHERE id = $1", id)
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

	_, err = store.Exec(c.Context(), h.store.Pool,
		"UPDATE _permissions SET entity = $1, action = $2, roles = $3, conditions = $4, updated_at = NOW() WHERE id = $5",
		perm.Entity, perm.Action, perm.Roles, condJSON, id)
	if err != nil {
		return fmt.Errorf("update permission: %w", err)
	}

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": perm})
}

func (h *Handler) DeletePermission(c *fiber.Ctx) error {
	id := c.Params("id")
	_, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id FROM _permissions WHERE id = $1", id)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Permission not found: " + id}})
	}

	_, err = store.Exec(c.Context(), h.store.Pool,
		"DELETE FROM _permissions WHERE id = $1", id)
	if err != nil {
		return fmt.Errorf("delete permission %s: %w", id, err)
	}

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"id": id, "deleted": true}})
}

// --- Webhook Endpoints ---

func (h *Handler) ListWebhooks(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.Pool,
		"SELECT id, entity, hook, url, method, headers, condition, async, retry, active, created_at, updated_at FROM _webhooks ORDER BY entity, hook")
	if err != nil {
		return fmt.Errorf("list webhooks: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	return c.JSON(fiber.Map{"data": rows})
}

func (h *Handler) GetWebhook(c *fiber.Ctx) error {
	id := c.Params("id")
	row, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id, entity, hook, url, method, headers, condition, async, retry, active, created_at, updated_at FROM _webhooks WHERE id = $1", id)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Webhook not found: " + id}})
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

	row, err := store.QueryRow(c.Context(), h.store.Pool,
		`INSERT INTO _webhooks (entity, hook, url, method, headers, condition, async, retry, active)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		 RETURNING id, entity, hook, url, method, headers, condition, async, retry, active, created_at, updated_at`,
		body["entity"], body["hook"], body["url"], body["method"],
		string(headersJSON), body["condition"], body["async"], string(retryJSON), body["active"])
	if err != nil {
		return fmt.Errorf("insert webhook: %w", err)
	}

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.Status(201).JSON(fiber.Map{"data": row})
}

func (h *Handler) UpdateWebhook(c *fiber.Ctx) error {
	id := c.Params("id")
	_, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id FROM _webhooks WHERE id = $1", id)
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

	_, err = store.Exec(c.Context(), h.store.Pool,
		`UPDATE _webhooks SET entity = $1, hook = $2, url = $3, method = $4, headers = $5,
		 condition = $6, async = $7, retry = $8, active = $9, updated_at = NOW() WHERE id = $10`,
		body["entity"], body["hook"], body["url"], body["method"],
		string(headersJSON), body["condition"], body["async"], string(retryJSON), body["active"], id)
	if err != nil {
		return fmt.Errorf("update webhook: %w", err)
	}

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	row, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id, entity, hook, url, method, headers, condition, async, retry, active, created_at, updated_at FROM _webhooks WHERE id = $1", id)
	if err != nil {
		return fmt.Errorf("fetch updated webhook: %w", err)
	}

	return c.JSON(fiber.Map{"data": row})
}

func (h *Handler) DeleteWebhook(c *fiber.Ctx) error {
	id := c.Params("id")
	_, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id FROM _webhooks WHERE id = $1", id)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Webhook not found: " + id}})
	}

	_, err = store.Exec(c.Context(), h.store.Pool,
		"DELETE FROM _webhooks WHERE id = $1", id)
	if err != nil {
		return fmt.Errorf("delete webhook %s: %w", id, err)
	}

	if err := metadata.Reload(c.Context(), h.store.Pool, h.registry); err != nil {
		return fmt.Errorf("reload registry: %w", err)
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"id": id, "deleted": true}})
}

// --- Webhook Log Endpoints ---

func (h *Handler) ListWebhookLogs(c *fiber.Ctx) error {
	query := "SELECT id, webhook_id, entity, hook, url, method, request_headers, request_body, response_status, response_body, status, attempt, max_attempts, next_retry_at, error, idempotency_key, created_at, updated_at FROM _webhook_logs"
	var conditions []string
	var args []any
	argIdx := 1

	if v := c.Query("webhook_id"); v != "" {
		conditions = append(conditions, fmt.Sprintf("webhook_id = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v := c.Query("status"); v != "" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v := c.Query("entity"); v != "" {
		conditions = append(conditions, fmt.Sprintf("entity = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}

	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY created_at DESC LIMIT 200"

	rows, err := store.QueryRows(c.Context(), h.store.Pool, query, args...)
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
	row, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id, webhook_id, entity, hook, url, method, request_headers, request_body, response_status, response_body, status, attempt, max_attempts, next_retry_at, error, idempotency_key, created_at, updated_at FROM _webhook_logs WHERE id = $1", id)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Webhook log not found: " + id}})
	}
	return c.JSON(fiber.Map{"data": row})
}

func (h *Handler) RetryWebhookLog(c *fiber.Ctx) error {
	id := c.Params("id")
	row, err := store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id, status, attempt, max_attempts FROM _webhook_logs WHERE id = $1", id)
	if err != nil {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Webhook log not found: " + id}})
	}

	status, _ := row["status"].(string)
	if status != "failed" && status != "retrying" {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": "Can only retry failed or retrying webhook logs"}})
	}

	_, err = store.Exec(c.Context(), h.store.Pool,
		"UPDATE _webhook_logs SET status = 'retrying', next_retry_at = NOW(), updated_at = NOW() WHERE id = $1", id)
	if err != nil {
		return fmt.Errorf("retry webhook log %s: %w", id, err)
	}

	row, err = store.QueryRow(c.Context(), h.store.Pool,
		"SELECT id, webhook_id, entity, hook, url, method, status, attempt, max_attempts, next_retry_at, updated_at FROM _webhook_logs WHERE id = $1", id)
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

// --- Export/Import Endpoints ---

func (h *Handler) Export(c *fiber.Ctx) error {
	ctx := c.Context()

	// Entities: definition column IS the full entity object
	entityRows, err := store.QueryRows(ctx, h.store.Pool,
		"SELECT definition FROM _entities ORDER BY name")
	if err != nil {
		return fmt.Errorf("export entities: %w", err)
	}
	entities := make([]any, 0, len(entityRows))
	for _, row := range entityRows {
		entities = append(entities, row["definition"])
	}

	// Relations: definition column IS the full relation object
	relRows, err := store.QueryRows(ctx, h.store.Pool,
		"SELECT definition FROM _relations ORDER BY name")
	if err != nil {
		return fmt.Errorf("export relations: %w", err)
	}
	relations := make([]any, 0, len(relRows))
	for _, row := range relRows {
		relations = append(relations, row["definition"])
	}

	// Rules
	ruleRows, err := store.QueryRows(ctx, h.store.Pool,
		"SELECT entity, hook, type, definition, priority, active FROM _rules ORDER BY entity, priority")
	if err != nil {
		return fmt.Errorf("export rules: %w", err)
	}
	rules := make([]map[string]any, 0, len(ruleRows))
	for _, row := range ruleRows {
		rules = append(rules, map[string]any{
			"entity": row["entity"], "hook": row["hook"], "type": row["type"],
			"definition": row["definition"], "priority": row["priority"], "active": row["active"],
		})
	}

	// State machines
	smRows, err := store.QueryRows(ctx, h.store.Pool,
		"SELECT entity, field, definition, active FROM _state_machines ORDER BY entity")
	if err != nil {
		return fmt.Errorf("export state machines: %w", err)
	}
	stateMachines := make([]map[string]any, 0, len(smRows))
	for _, row := range smRows {
		stateMachines = append(stateMachines, map[string]any{
			"entity": row["entity"], "field": row["field"],
			"definition": row["definition"], "active": row["active"],
		})
	}

	// Workflows
	wfRows, err := store.QueryRows(ctx, h.store.Pool,
		"SELECT name, trigger, context, steps, active FROM _workflows ORDER BY name")
	if err != nil {
		return fmt.Errorf("export workflows: %w", err)
	}
	workflows := make([]map[string]any, 0, len(wfRows))
	for _, row := range wfRows {
		workflows = append(workflows, map[string]any{
			"name": row["name"], "trigger": row["trigger"],
			"context": row["context"], "steps": row["steps"], "active": row["active"],
		})
	}

	// Permissions
	permRows, err := store.QueryRows(ctx, h.store.Pool,
		"SELECT entity, action, roles, conditions FROM _permissions ORDER BY entity, action")
	if err != nil {
		return fmt.Errorf("export permissions: %w", err)
	}
	permissions := make([]map[string]any, 0, len(permRows))
	for _, row := range permRows {
		permissions = append(permissions, map[string]any{
			"entity": row["entity"], "action": row["action"],
			"roles": row["roles"], "conditions": row["conditions"],
		})
	}

	// Webhooks
	whRows, err := store.QueryRows(ctx, h.store.Pool,
		"SELECT entity, hook, url, method, headers, condition, async, retry, active FROM _webhooks ORDER BY entity, hook")
	if err != nil {
		return fmt.Errorf("export webhooks: %w", err)
	}
	webhooks := make([]map[string]any, 0, len(whRows))
	for _, row := range whRows {
		webhooks = append(webhooks, map[string]any{
			"entity": row["entity"], "hook": row["hook"], "url": row["url"],
			"method": row["method"], "headers": row["headers"], "condition": row["condition"],
			"async": row["async"], "retry": row["retry"], "active": row["active"],
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
	}})
}

func (h *Handler) Import(c *fiber.Ctx) error {
	var payload struct {
		Version       int                              `json:"version"`
		Entities      []map[string]any                 `json:"entities"`
		Relations     []map[string]any                 `json:"relations"`
		Rules         []map[string]any                 `json:"rules"`
		StateMachines []map[string]any                 `json:"state_machines"`
		Workflows     []map[string]any                 `json:"workflows"`
		Permissions   []map[string]any                 `json:"permissions"`
		Webhooks      []map[string]any                 `json:"webhooks"`
		SampleData    map[string][]map[string]any      `json:"sample_data"`
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
		_, err = store.Exec(ctx, h.store.Pool,
			"INSERT INTO _entities (name, table_name, definition) VALUES ($1, $2, $3)",
			name, table, defJSON)
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
	_ = metadata.Reload(ctx, h.store.Pool, h.registry)

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
		_, err = store.Exec(ctx, h.store.Pool,
			"INSERT INTO _relations (name, source, target, definition) VALUES ($1, $2, $3, $4)",
			name, source, target, defJSON)
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
	existingRules, _ := store.QueryRows(ctx, h.store.Pool,
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
		_, err := store.QueryRow(ctx, h.store.Pool,
			"INSERT INTO _rules (entity, hook, type, definition, priority, active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
			raw["entity"], raw["hook"], raw["type"], defJSON, raw["priority"], raw["active"])
		if err != nil {
			errors = append(errors, fmt.Sprintf("Rule (%v/%v): %v", raw["entity"], raw["hook"], err))
			continue
		}
		ruleSet[key] = true
		summary["rules"]++
	}

	// Step 4: State machines (dedup by entity+field)
	existingSMs, _ := store.QueryRows(ctx, h.store.Pool,
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
		_, err := store.QueryRow(ctx, h.store.Pool,
			"INSERT INTO _state_machines (entity, field, definition, active) VALUES ($1,$2,$3,$4) RETURNING id",
			raw["entity"], raw["field"], defJSON, raw["active"])
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
		_, err := store.QueryRow(ctx, h.store.Pool, "SELECT id FROM _workflows WHERE name = $1", name)
		if err == nil {
			continue // already exists
		}
		triggerJSON, _ := json.Marshal(raw["trigger"])
		contextJSON, _ := json.Marshal(raw["context"])
		stepsJSON, _ := json.Marshal(raw["steps"])
		_, err = store.QueryRow(ctx, h.store.Pool,
			"INSERT INTO _workflows (name, trigger, context, steps, active) VALUES ($1,$2,$3,$4,$5) RETURNING id",
			name, triggerJSON, contextJSON, stepsJSON, raw["active"])
		if err != nil {
			errors = append(errors, fmt.Sprintf("Workflow %s: %v", name, err))
			continue
		}
		summary["workflows"]++
	}

	// Step 6: Permissions (dedup by entity+action)
	existingPerms, _ := store.QueryRows(ctx, h.store.Pool,
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
		_, err := store.QueryRow(ctx, h.store.Pool,
			"INSERT INTO _permissions (entity, action, roles, conditions) VALUES ($1,$2,$3,$4) RETURNING id",
			raw["entity"], raw["action"], raw["roles"], condJSON)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Permission (%v/%v): %v", raw["entity"], raw["action"], err))
			continue
		}
		permSet[key] = true
		summary["permissions"]++
	}

	// Step 7: Webhooks (dedup by entity+hook+url)
	existingWHs, _ := store.QueryRows(ctx, h.store.Pool,
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
		_, err := store.QueryRow(ctx, h.store.Pool,
			`INSERT INTO _webhooks (entity, hook, url, method, headers, condition, async, retry, active)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
			raw["entity"], hook, raw["url"], method,
			string(headersJSON), condition, async, string(retryJSON), active)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Webhook (%v/%v/%v): %v", raw["entity"], raw["hook"], raw["url"], err))
			continue
		}
		whSet[key] = true
		summary["webhooks"]++
	}

	// Final reload
	_ = metadata.Reload(ctx, h.store.Pool, h.registry)

	// Step 8: Sample data (insert records into business tables)
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
				cols := make([]string, 0, len(record))
				placeholders := make([]string, 0, len(record))
				values := make([]any, 0, len(record))
				i := 1
				for key, val := range record {
					ft, ok := fieldTypes[key]
					if !ok {
						continue
					}
					// Convert JSON float64 to proper Go types for pgx
					if v, isFloat := val.(float64); isFloat {
						switch ft {
						case "integer", "int", "bigint":
							val = int64(v)
						}
					}
					cols = append(cols, `"`+key+`"`)
					placeholders = append(placeholders, fmt.Sprintf("$%d", i))
					values = append(values, val)
					i++
				}
				if len(cols) == 0 {
					continue
				}
				query := fmt.Sprintf(
					`INSERT INTO %q (%s) VALUES (%s) ON CONFLICT DO NOTHING`,
					entity.Table, strings.Join(cols, ", "), strings.Join(placeholders, ", "),
				)
				_, err := store.Exec(ctx, h.store.Pool, query, values...)
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
				cols := make([]string, 0, len(record))
				placeholders := make([]string, 0, len(record))
				values := make([]any, 0, len(record))
				i := 1
				for k, v := range record {
					if !validCols[k] {
						continue
					}
					cols = append(cols, `"`+k+`"`)
					placeholders = append(placeholders, fmt.Sprintf("$%d", i))
					values = append(values, v)
					i++
				}
				if len(cols) == 0 {
					continue
				}
				query := fmt.Sprintf(
					`INSERT INTO %q (%s) VALUES (%s) ON CONFLICT DO NOTHING`,
					tableName, strings.Join(cols, ", "), strings.Join(placeholders, ", "),
				)
				_, err := store.Exec(ctx, h.store.Pool, query, values...)
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
