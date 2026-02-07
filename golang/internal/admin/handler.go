package admin

import (
	"encoding/json"
	"fmt"

	"github.com/gofiber/fiber/v2"

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

func RegisterAdminRoutes(app *fiber.App, h *Handler) {
	admin := app.Group("/api/_admin")

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
