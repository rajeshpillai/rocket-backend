package multiapp

import (
	"rocket-backend/internal/admin"
	"rocket-backend/internal/auth"
	"rocket-backend/internal/engine"
	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

// AppContext holds all per-app resources: database pool, metadata cache, and pre-built handlers.
type AppContext struct {
	Name      string
	DBName    string
	JWTSecret string

	Store    *store.Store
	Registry *metadata.Registry
	Migrator *store.Migrator

	EngineHandler   *engine.Handler
	AdminHandler    *admin.Handler
	AuthHandler     *auth.AuthHandler
	WorkflowHandler *engine.WorkflowHandler
}

// BuildHandlers creates all handler instances for this app context.
func (ac *AppContext) BuildHandlers() {
	ac.Migrator = store.NewMigrator(ac.Store)
	ac.EngineHandler = engine.NewHandler(ac.Store, ac.Registry)
	ac.AdminHandler = admin.NewHandler(ac.Store, ac.Registry, ac.Migrator)
	ac.AuthHandler = auth.NewAuthHandler(ac.Store, ac.JWTSecret)
	ac.WorkflowHandler = engine.NewWorkflowHandler(ac.Store, ac.Registry)
}

// AppInfo is a summary of an app returned by List.
type AppInfo struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	DBName      string `json:"db_name"`
	Status      string `json:"status"`
	CreatedAt   any    `json:"created_at"`
	UpdatedAt   any    `json:"updated_at"`
}
