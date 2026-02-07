package engine

import (
	"github.com/gofiber/fiber/v2"

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
func RegisterWorkflowRoutes(app *fiber.App, h *WorkflowHandler) {
	wf := app.Group("/api/_workflows")
	wf.Get("/pending", h.ListPending)
	wf.Get("/:id", h.GetInstance)
	wf.Post("/:id/approve", h.Approve)
	wf.Post("/:id/reject", h.Reject)
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
	id := c.Params("id")
	userID := c.Get("X-User-ID", "anonymous") // Until Auth is implemented

	instance, err := ResolveWorkflowAction(c.Context(), h.store, h.registry, id, "approved", userID)
	if err != nil {
		return NewAppError("VALIDATION_FAILED", 422, err.Error())
	}

	return c.JSON(fiber.Map{"data": instance})
}

func (h *WorkflowHandler) Reject(c *fiber.Ctx) error {
	id := c.Params("id")
	userID := c.Get("X-User-ID", "anonymous")

	instance, err := ResolveWorkflowAction(c.Context(), h.store, h.registry, id, "rejected", userID)
	if err != nil {
		return NewAppError("VALIDATION_FAILED", 422, err.Error())
	}

	return c.JSON(fiber.Map{"data": instance})
}
