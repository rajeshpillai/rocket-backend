package engine

import (
	"github.com/gofiber/fiber/v2"

	"rocket-backend/internal/instrument"
	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

// WorkflowHandler handles workflow runtime HTTP endpoints.
type WorkflowHandler struct {
	store    *store.Store
	registry *metadata.Registry
}

func NewWorkflowHandler(s *store.Store, reg *metadata.Registry) *WorkflowHandler {
	return &WorkflowHandler{store: s, registry: reg}
}

// RegisterWorkflowRoutes adds workflow runtime routes.
// Must be registered AFTER admin routes but BEFORE dynamic entity routes.
func RegisterWorkflowRoutes(app *fiber.App, h *WorkflowHandler, middleware ...fiber.Handler) {
	wf := app.Group("/api/_workflows", middleware...)
	wf.Get("/pending", h.ListPending)
	wf.Get("/:id", h.GetInstance)
	wf.Post("/:id/approve", h.Approve)
	wf.Post("/:id/reject", h.Reject)
	wf.Delete("/:id", h.Delete)
}

func (h *WorkflowHandler) GetInstance(c *fiber.Ctx) error {
	id := c.Params("id")
	instance, err := loadWorkflowInstance(c.Context(), h.store, id)
	if err != nil {
		return NewAppError("NOT_FOUND", 404, "Workflow instance not found: "+id)
	}
	return c.JSON(fiber.Map{"data": instance})
}

func (h *WorkflowHandler) ListPending(c *fiber.Ctx) error {
	instances, err := ListPendingInstances(c.Context(), h.store)
	if err != nil {
		return NewAppError("INTERNAL_ERROR", 500, "Failed to list pending instances")
	}
	if instances == nil {
		instances = []*metadata.WorkflowInstance{}
	}
	return c.JSON(fiber.Map{"data": instances})
}

func (h *WorkflowHandler) Approve(c *fiber.Ctx) error {
	ctx := c.UserContext()
	ctx, span := instrument.GetInstrumenter(ctx).StartSpan(ctx, "workflow", "handler", "workflow.approve")
	defer span.End()
	c.SetUserContext(ctx)

	id := c.Params("id")
	span.SetMetadata("instance_id", id)
	userID := c.Get("X-User-ID", "anonymous") // Until Auth is implemented

	instance, err := ResolveWorkflowAction(c.Context(), h.store, h.registry, id, "approved", userID)
	if err != nil {
		span.SetStatus("error")
		span.SetMetadata("error", err.Error())
		return NewAppError("VALIDATION_FAILED", 422, err.Error())
	}

	span.SetStatus("ok")
	return c.JSON(fiber.Map{"data": instance})
}

func (h *WorkflowHandler) Delete(c *fiber.Ctx) error {
	id := c.Params("id")
	if err := DeleteWorkflowInstance(c.Context(), h.store, id); err != nil {
		return NewAppError("NOT_FOUND", 404, "Workflow instance not found: "+id)
	}
	return c.JSON(fiber.Map{"data": fiber.Map{"deleted": true}})
}

func (h *WorkflowHandler) Reject(c *fiber.Ctx) error {
	ctx := c.UserContext()
	ctx, span := instrument.GetInstrumenter(ctx).StartSpan(ctx, "workflow", "handler", "workflow.reject")
	defer span.End()
	c.SetUserContext(ctx)

	id := c.Params("id")
	span.SetMetadata("instance_id", id)
	userID := c.Get("X-User-ID", "anonymous")

	instance, err := ResolveWorkflowAction(c.Context(), h.store, h.registry, id, "rejected", userID)
	if err != nil {
		span.SetStatus("error")
		span.SetMetadata("error", err.Error())
		return NewAppError("VALIDATION_FAILED", 422, err.Error())
	}

	span.SetStatus("ok")
	return c.JSON(fiber.Map{"data": instance})
}
