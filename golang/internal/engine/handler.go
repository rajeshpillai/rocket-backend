package engine

import (
	"errors"
	"fmt"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgconn"

	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

type Handler struct {
	store    *store.Store
	registry *metadata.Registry
}

func NewHandler(s *store.Store, reg *metadata.Registry) *Handler {
	return &Handler{store: s, registry: reg}
}

// List handles GET /api/:entity
func (h *Handler) List(c *fiber.Ctx) error {
	entity, err := h.resolveEntity(c)
	if err != nil {
		return err
	}

	user := getUser(c)
	if err := CheckPermission(user, entity.Name, "read", h.registry, nil); err != nil {
		return err
	}

	plan, err := ParseQueryParams(c, entity, h.registry)
	if err != nil {
		return err
	}

	// Inject row-level security filters
	if filters := GetReadFilters(user, entity.Name, h.registry); len(filters) > 0 {
		plan.Filters = append(plan.Filters, filters...)
	}

	// Execute data query
	qr := BuildSelectSQL(plan)
	rows, err := store.QueryRows(c.Context(), h.store.Pool, qr.SQL, qr.Params...)
	if err != nil {
		return fmt.Errorf("list %s: %w", entity.Name, err)
	}

	// Execute count query
	cr := BuildCountSQL(plan)
	countRow, err := store.QueryRow(c.Context(), h.store.Pool, cr.SQL, cr.Params...)
	if err != nil {
		return fmt.Errorf("count %s: %w", entity.Name, err)
	}
	total := countRow["count"]

	// Load includes
	if len(plan.Includes) > 0 {
		if err := LoadIncludes(c.Context(), h.store.Pool, h.registry, entity, rows, plan.Includes); err != nil {
			return fmt.Errorf("load includes: %w", err)
		}
	}

	// Ensure non-nil slice for JSON
	if rows == nil {
		rows = []map[string]any{}
	}

	return c.JSON(fiber.Map{
		"data": rows,
		"meta": fiber.Map{
			"page":     plan.Page,
			"per_page": plan.PerPage,
			"total":    total,
		},
	})
}

// GetByID handles GET /api/:entity/:id
func (h *Handler) GetByID(c *fiber.Ctx) error {
	entity, err := h.resolveEntity(c)
	if err != nil {
		return err
	}

	user := getUser(c)
	if err := CheckPermission(user, entity.Name, "read", h.registry, nil); err != nil {
		return err
	}

	id := c.Params("id")
	row, err := fetchRecord(c.Context(), h.store.Pool, entity, id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return respondError(c, NotFoundError(entity.Name, id))
		}
		return fmt.Errorf("get %s/%s: %w", entity.Name, id, err)
	}

	// Load includes
	includes := parseIncludes(c)
	if len(includes) > 0 {
		rows := []map[string]any{row}
		if err := LoadIncludes(c.Context(), h.store.Pool, h.registry, entity, rows, includes); err != nil {
			return fmt.Errorf("load includes: %w", err)
		}
		row = rows[0]
	}

	return c.JSON(fiber.Map{"data": row})
}

// Create handles POST /api/:entity
func (h *Handler) Create(c *fiber.Ctx) error {
	entity, err := h.resolveEntity(c)
	if err != nil {
		return err
	}

	user := getUser(c)
	if err := CheckPermission(user, entity.Name, "create", h.registry, nil); err != nil {
		return err
	}

	var body map[string]any
	if err := c.BodyParser(&body); err != nil {
		return respondError(c, NewAppError("INVALID_PAYLOAD", 400, "Invalid JSON body"))
	}

	plan, validationErrs := PlanWrite(entity, h.registry, body, nil)
	if len(validationErrs) > 0 {
		return respondError(c, ValidationError(validationErrs))
	}

	record, err := ExecuteWritePlan(c.Context(), h.store, h.registry, plan)
	if err != nil {
		return handleWriteError(c, err)
	}

	return c.Status(201).JSON(fiber.Map{"data": record})
}

// Update handles PUT /api/:entity/:id
func (h *Handler) Update(c *fiber.Ctx) error {
	entity, err := h.resolveEntity(c)
	if err != nil {
		return err
	}

	id := c.Params("id")

	// Verify record exists and check permissions against current state
	currentRecord, err := fetchRecord(c.Context(), h.store.Pool, entity, id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return respondError(c, NotFoundError(entity.Name, id))
		}
		return fmt.Errorf("fetch %s/%s: %w", entity.Name, id, err)
	}

	user := getUser(c)
	if err := CheckPermission(user, entity.Name, "update", h.registry, currentRecord); err != nil {
		return err
	}

	var body map[string]any
	if err := c.BodyParser(&body); err != nil {
		return respondError(c, NewAppError("INVALID_PAYLOAD", 400, "Invalid JSON body"))
	}

	plan, validationErrs := PlanWrite(entity, h.registry, body, id)
	if len(validationErrs) > 0 {
		return respondError(c, ValidationError(validationErrs))
	}

	record, err := ExecuteWritePlan(c.Context(), h.store, h.registry, plan)
	if err != nil {
		return handleWriteError(c, err)
	}

	return c.JSON(fiber.Map{"data": record})
}

// Delete handles DELETE /api/:entity/:id
func (h *Handler) Delete(c *fiber.Ctx) error {
	entity, err := h.resolveEntity(c)
	if err != nil {
		return err
	}

	id := c.Params("id")

	// Check permissions against current record
	currentRecord, err := fetchRecord(c.Context(), h.store.Pool, entity, id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return respondError(c, NotFoundError(entity.Name, id))
		}
		return fmt.Errorf("fetch %s/%s: %w", entity.Name, id, err)
	}

	user := getUser(c)
	if err := CheckPermission(user, entity.Name, "delete", h.registry, currentRecord); err != nil {
		return err
	}

	tx, err := h.store.BeginTx(c.Context())
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(c.Context()) //nolint:errcheck

	// Handle cascades
	if err := HandleCascadeDelete(c.Context(), tx, h.registry, entity, id); err != nil {
		var appErr *AppError
		if errors.As(err, &appErr) {
			return respondError(c, appErr)
		}
		return fmt.Errorf("cascade delete: %w", err)
	}

	// Delete the record
	var sql string
	var params []any
	if entity.SoftDelete {
		sql, params = BuildSoftDeleteSQL(entity, id)
	} else {
		sql, params = BuildHardDeleteSQL(entity, id)
	}

	affected, err := store.Exec(c.Context(), tx, sql, params...)
	if err != nil {
		return fmt.Errorf("delete %s/%s: %w", entity.Name, id, err)
	}
	if affected == 0 {
		return respondError(c, NotFoundError(entity.Name, id))
	}

	if err := tx.Commit(c.Context()); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"id": id}})
}

func (h *Handler) resolveEntity(c *fiber.Ctx) (*metadata.Entity, error) {
	name := c.Params("entity")
	entity := h.registry.GetEntity(name)
	if entity == nil {
		return nil, respondError(c, UnknownEntityError(name))
	}
	return entity, nil
}

func getUser(c *fiber.Ctx) *metadata.UserContext {
	user, _ := c.Locals("user").(*metadata.UserContext)
	return user
}

func respondError(c *fiber.Ctx, appErr *AppError) error {
	return c.Status(appErr.Status).JSON(ErrorResponse{Error: appErr})
}

func handleWriteError(c *fiber.Ctx, err error) error {
	var appErr *AppError
	if errors.As(err, &appErr) {
		return respondError(c, appErr)
	}

	if errors.Is(err, store.ErrUniqueViolation) {
		msg := "A record with this value already exists"
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Detail != "" {
			msg = pgErr.Detail
		}
		return respondError(c, ConflictError(msg))
	}

	return err
}

func parseIncludes(c *fiber.Ctx) []string {
	inc := c.Query("include")
	if inc == "" {
		return nil
	}
	var includes []string
	for _, name := range splitAndTrim(inc) {
		includes = append(includes, name)
	}
	return includes
}

func splitAndTrim(s string) []string {
	parts := make([]string, 0)
	for _, p := range splitComma(s) {
		trimmed := trimSpace(p)
		if trimmed != "" {
			parts = append(parts, trimmed)
		}
	}
	return parts
}

func splitComma(s string) []string {
	var parts []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == ',' {
			parts = append(parts, s[start:i])
			start = i + 1
		}
	}
	parts = append(parts, s[start:])
	return parts
}

func trimSpace(s string) string {
	start := 0
	end := len(s)
	for start < end && s[start] == ' ' {
		start++
	}
	for end > start && s[end-1] == ' ' {
		end--
	}
	return s[start:end]
}
