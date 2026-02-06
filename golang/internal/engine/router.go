package engine

import "github.com/gofiber/fiber/v2"

func RegisterDynamicRoutes(app *fiber.App, h *Handler) {
	api := app.Group("/api")

	api.Get("/:entity", h.List)
	api.Get("/:entity/:id", h.GetByID)
	api.Post("/:entity", h.Create)
	api.Put("/:entity/:id", h.Update)
	api.Delete("/:entity/:id", h.Delete)
}
