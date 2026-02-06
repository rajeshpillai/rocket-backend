package main

import (
	"context"
	"errors"
	"fmt"
	"log"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"

	"rocket-backend/internal/admin"
	"rocket-backend/internal/config"
	"rocket-backend/internal/engine"
	"rocket-backend/internal/metadata"
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

	// 2. Connect to database
	db, err := store.New(ctx, cfg.Database)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()
	log.Println("Database connected")

	// 3. Bootstrap system tables
	if err := db.Bootstrap(ctx); err != nil {
		log.Fatalf("Failed to bootstrap system tables: %v", err)
	}
	log.Println("System tables ready")

	// 4. Create registry and load metadata
	reg := metadata.NewRegistry()
	if err := metadata.LoadAll(ctx, db.Pool, reg); err != nil {
		log.Printf("WARN: Failed to load metadata: %v", err)
	}

	// 5. Create migrator
	migrator := store.NewMigrator(db)

	// 6. Create Fiber app
	app := fiber.New(fiber.Config{
		ErrorHandler: errorHandler,
	})
	app.Use(recover.New())
	app.Use(logger.New(logger.Config{
		Format: "${time} ${status} ${method} ${path} ${latency}\n",
	}))

	// 7. Health check
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})

	// 8. Register admin routes FIRST (before dynamic routes)
	adminHandler := admin.NewHandler(db, reg, migrator)
	admin.RegisterAdminRoutes(app, adminHandler)

	// 9. Register dynamic entity routes
	engineHandler := engine.NewHandler(db, reg)
	engine.RegisterDynamicRoutes(app, engineHandler)

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
