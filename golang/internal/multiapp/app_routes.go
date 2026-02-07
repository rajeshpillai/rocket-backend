package multiapp

import (
	"github.com/gofiber/fiber/v2"

	"rocket-backend/internal/auth"
)

// dispatch returns a Fiber handler that extracts the AppContext from the request
// and delegates to the handler function returned by fn.
func dispatch(fn func(*AppContext) fiber.Handler) fiber.Handler {
	return func(c *fiber.Ctx) error {
		ac := GetAppCtx(c)
		if ac == nil {
			return fiber.NewError(500, "App context not found")
		}
		return fn(ac)(c)
	}
}

// RegisterAppRoutes registers all app-scoped routes under /api/:app.
func RegisterAppRoutes(app *fiber.App, manager *AppManager, platformJWTSecret string) {
	resolverMW := AppResolverMiddleware(manager)
	appAuthMW := AppAuthMiddleware(platformJWTSecret)
	adminMW := auth.RequireAdmin()

	// Auth routes (no auth required, only app resolver)
	appAuth := app.Group("/api/:app/auth", resolverMW)
	appAuth.Post("/login", dispatch(func(ac *AppContext) fiber.Handler { return ac.AuthHandler.Login }))
	appAuth.Post("/refresh", dispatch(func(ac *AppContext) fiber.Handler { return ac.AuthHandler.Refresh }))
	appAuth.Post("/logout", dispatch(func(ac *AppContext) fiber.Handler { return ac.AuthHandler.Logout }))

	// All other routes require app resolver + auth
	protected := app.Group("/api/:app", resolverMW, appAuthMW)

	// Admin routes (admin required)
	adm := protected.Group("/_admin", adminMW)

	// Entities
	adm.Get("/entities", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.ListEntities }))
	adm.Get("/entities/:name", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.GetEntity }))
	adm.Post("/entities", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.CreateEntity }))
	adm.Put("/entities/:name", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.UpdateEntity }))
	adm.Delete("/entities/:name", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.DeleteEntity }))

	// Relations
	adm.Get("/relations", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.ListRelations }))
	adm.Get("/relations/:name", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.GetRelation }))
	adm.Post("/relations", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.CreateRelation }))
	adm.Put("/relations/:name", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.UpdateRelation }))
	adm.Delete("/relations/:name", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.DeleteRelation }))

	// Rules
	adm.Get("/rules", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.ListRules }))
	adm.Get("/rules/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.GetRule }))
	adm.Post("/rules", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.CreateRule }))
	adm.Put("/rules/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.UpdateRule }))
	adm.Delete("/rules/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.DeleteRule }))

	// State Machines
	adm.Get("/state-machines", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.ListStateMachines }))
	adm.Get("/state-machines/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.GetStateMachine }))
	adm.Post("/state-machines", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.CreateStateMachine }))
	adm.Put("/state-machines/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.UpdateStateMachine }))
	adm.Delete("/state-machines/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.DeleteStateMachine }))

	// Workflows
	adm.Get("/workflows", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.ListWorkflows }))
	adm.Get("/workflows/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.GetWorkflow }))
	adm.Post("/workflows", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.CreateWorkflow }))
	adm.Put("/workflows/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.UpdateWorkflow }))
	adm.Delete("/workflows/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.DeleteWorkflow }))

	// Users
	adm.Get("/users", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.ListUsers }))
	adm.Get("/users/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.GetUser }))
	adm.Post("/users", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.CreateUser }))
	adm.Put("/users/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.UpdateUser }))
	adm.Delete("/users/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.DeleteUser }))

	// Permissions
	adm.Get("/permissions", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.ListPermissions }))
	adm.Get("/permissions/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.GetPermission }))
	adm.Post("/permissions", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.CreatePermission }))
	adm.Put("/permissions/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.UpdatePermission }))
	adm.Delete("/permissions/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.DeletePermission }))

	// Webhooks
	adm.Get("/webhooks", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.ListWebhooks }))
	adm.Get("/webhooks/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.GetWebhook }))
	adm.Post("/webhooks", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.CreateWebhook }))
	adm.Put("/webhooks/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.UpdateWebhook }))
	adm.Delete("/webhooks/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.DeleteWebhook }))

	// Webhook Logs
	adm.Get("/webhook-logs", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.ListWebhookLogs }))
	adm.Get("/webhook-logs/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.GetWebhookLog }))
	adm.Post("/webhook-logs/:id/retry", dispatch(func(ac *AppContext) fiber.Handler { return ac.AdminHandler.RetryWebhookLog }))

	// Workflow runtime routes
	wf := protected.Group("/_workflows")
	wf.Get("/pending", dispatch(func(ac *AppContext) fiber.Handler { return ac.WorkflowHandler.ListPending }))
	wf.Get("/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.WorkflowHandler.GetInstance }))
	wf.Post("/:id/approve", dispatch(func(ac *AppContext) fiber.Handler { return ac.WorkflowHandler.Approve }))
	wf.Post("/:id/reject", dispatch(func(ac *AppContext) fiber.Handler { return ac.WorkflowHandler.Reject }))

	// Dynamic entity routes (must be last — catch-all pattern)
	protected.Get("/:entity", dispatch(func(ac *AppContext) fiber.Handler { return ac.EngineHandler.List }))
	protected.Get("/:entity/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.EngineHandler.GetByID }))
	protected.Post("/:entity", dispatch(func(ac *AppContext) fiber.Handler { return ac.EngineHandler.Create }))
	protected.Put("/:entity/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.EngineHandler.Update }))
	protected.Delete("/:entity/:id", dispatch(func(ac *AppContext) fiber.Handler { return ac.EngineHandler.Delete }))
}
