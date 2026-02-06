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
