package multiapp

import (
	"rocket-backend/internal/admin"
	"rocket-backend/internal/ai"
	"rocket-backend/internal/auth"
	"rocket-backend/internal/engine"
	"rocket-backend/internal/instrument"
	"rocket-backend/internal/metadata"
	"rocket-backend/internal/storage"
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
	FileHandler     *engine.FileHandler
	EventHandler    *instrument.EventHandler
	AIHandler       *ai.Handler
	EventBuffer     *instrument.EventBuffer

	// Injected by manager for building FileHandler
	fileStorage storage.FileStorage
	maxFileSize int64

	// Injected by manager for building AIHandler
	aiProvider *ai.Provider
}

// BuildHandlers creates all handler instances for this app context.
func (ac *AppContext) BuildHandlers() {
	ac.Migrator = store.NewMigrator(ac.Store)
	ac.EngineHandler = engine.NewHandler(ac.Store, ac.Registry)
	ac.AdminHandler = admin.NewHandler(ac.Store, ac.Registry, ac.Migrator)
	ac.AuthHandler = auth.NewAuthHandler(ac.Store, ac.JWTSecret)
	ac.WorkflowHandler = engine.NewWorkflowHandler(ac.Store, ac.Registry)
	if ac.fileStorage != nil {
		ac.FileHandler = engine.NewFileHandler(ac.Store, ac.fileStorage, ac.maxFileSize, ac.Name)
	}
	ac.EventHandler = instrument.NewEventHandler(ac.Store.DB, ac.Store.Dialect)
	if ac.aiProvider != nil {
		ac.AIHandler = ai.NewHandler(ac.aiProvider, ac.Registry)
	}
}

// AppInfo is a summary of an app returned by List.
type AppInfo struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	DBName      string `json:"db_name"`
	DBDriver    string `json:"db_driver"`
	Status      string `json:"status"`
	CreatedAt   any    `json:"created_at"`
	UpdatedAt   any    `json:"updated_at"`
}
