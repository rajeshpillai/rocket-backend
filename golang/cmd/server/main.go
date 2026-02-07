package main

import (
	"context"
	"errors"
	"fmt"
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"

	"rocket-backend/internal/config"
	"rocket-backend/internal/engine"
	"rocket-backend/internal/multiapp"
	"rocket-backend/internal/store"
)

func main() {
	ctx := context.Background()

	// 1. Load config
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	log.Printf("Config loaded (port: %d, db: %s:%d/%s)", cfg.Server.Port, cfg.Database.Host, cfg.Database.Port, cfg.Database.Name)

	// 2. Connect to management database
	mgmtStore, err := store.New(ctx, cfg.Database)
	if err != nil {
		log.Fatalf("Failed to connect to management database: %v", err)
	}
	defer mgmtStore.Close()
	log.Println("Management database connected")

	// 3. Bootstrap platform tables (_apps, _platform_users, _platform_refresh_tokens)
	if err := multiapp.PlatformBootstrap(ctx, mgmtStore.Pool); err != nil {
		log.Fatalf("Failed to bootstrap platform tables: %v", err)
	}
	log.Println("Platform tables ready")

	// 4. Create AppManager and load all existing apps
	manager := multiapp.NewAppManager(mgmtStore, cfg.Database, cfg.AppPoolSize)
	defer manager.Close()

	if err := manager.LoadAll(ctx); err != nil {
		log.Printf("WARN: Failed to load apps: %v", err)
	}

	// 5. Create Fiber app
	app := fiber.New(fiber.Config{
		ErrorHandler: errorHandler,
	})
	app.Use(recover.New(recover.Config{
		EnableStackTrace: true,
	}))
	app.Use(logger.New(logger.Config{
		Format: "${time} ${status} ${method} ${path} ${latency}\n",
	}))

	// 6. Health check
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})

	// 7. Platform routes (auth + app CRUD)
	platformHandler := multiapp.NewPlatformHandler(mgmtStore, cfg.PlatformJWTSecret, manager)
	platformAuthMW := multiapp.PlatformAuthMiddleware(cfg.PlatformJWTSecret)
	multiapp.RegisterPlatformRoutes(app, platformHandler, platformAuthMW)

	// 8. App-scoped routes (all existing CRUD/admin/auth/workflow routes under /api/:app)
	multiapp.RegisterAppRoutes(app, manager, cfg.PlatformJWTSecret)

	// 9. Start multi-app schedulers
	scheduler := multiapp.NewMultiAppScheduler(manager)
	scheduler.Start()
	defer scheduler.Stop()

	// 10. Start server
	addr := fmt.Sprintf(":%d", cfg.Server.Port)
	log.Printf("Starting server on %s", addr)
	log.Fatal(app.Listen(addr))
}

func errorHandler(c *fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError

	var fiberErr *fiber.Error
	if errors.As(err, &fiberErr) {
		code = fiberErr.Code
	}

	var appErr *engine.AppError
	if errors.As(err, &appErr) {
		return c.Status(appErr.Status).JSON(engine.ErrorResponse{Error: appErr})
	}

	log.Printf("ERROR: %v", err)
	return c.Status(code).JSON(engine.ErrorResponse{
		Error: &engine.AppError{
			Code:    "INTERNAL_ERROR",
			Message: "Internal server error",
		},
	})
}
