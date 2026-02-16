package engine

import "github.com/gofiber/fiber/v2"

// RegisterDynamicRoutes registers parameterized entity routes.
// Routes are registered directly on the app (not via app.Group("/api"))
// to avoid Fiber route-tree conflicts with static routes under /api/auth
// and /api/_admin that are registered by other groups.
func RegisterDynamicRoutes(app *fiber.App, h *Handler, middleware ...fiber.Handler) {
	wrap := func(fn fiber.Handler) []fiber.Handler {
		all := make([]fiber.Handler, len(middleware)+1)
		copy(all, middleware)
		all[len(middleware)] = fn
		return all
	}

	app.Get("/api/:entity", wrap(h.List)...)
	app.Get("/api/:entity/:id", wrap(h.GetByID)...)
	app.Post("/api/:entity", wrap(h.Create)...)
	app.Put("/api/:entity/:id", wrap(h.Update)...)
	app.Delete("/api/:entity/:id", wrap(h.Delete)...)
}
