import express from "express";
import morgan from "morgan";
import { loadConfig } from "./config/index.js";
import { Store } from "./store/postgres.js";
import { bootstrap } from "./store/bootstrap.js";
import { Migrator } from "./store/migrator.js";
import { Registry } from "./metadata/registry.js";
import { loadAll } from "./metadata/loader.js";
import { Handler } from "./engine/handler.js";
import { registerDynamicRoutes } from "./engine/router.js";
import { AdminHandler, registerAdminRoutes } from "./admin/handler.js";
import { WorkflowHandler, registerWorkflowRoutes } from "./engine/workflow-handler.js";
import { WorkflowScheduler } from "./engine/workflow-scheduler.js";
import { WebhookScheduler } from "./engine/webhook-scheduler.js";
import { AuthHandler, registerAuthRoutes } from "./auth/handler.js";
import { authMiddleware, requireAdmin } from "./auth/middleware.js";
import { errorHandler } from "./middleware/error-handler.js";

async function main() {
  // 1. Load config
  const cfg = loadConfig();
  console.log(
    `Config loaded (port: ${cfg.server.port}, db: ${cfg.database.host}:${cfg.database.port}/${cfg.database.name})`,
  );

  // 2. Connect to database
  const store = await Store.connect(cfg.database);
  console.log("Database connected");

  // 3. Bootstrap system tables
  await bootstrap(store.pool);
  console.log("System tables ready");

  // 4. Create registry and load metadata
  const registry = new Registry();
  try {
    await loadAll(store.pool, registry);
  } catch (err) {
    console.warn("WARN: Failed to load metadata:", err);
  }

  // 5. Create migrator
  const migrator = new Migrator(store);

  // 6. Create Express app
  const app = express();
  app.use(express.json());
  app.use(
    morgan(":date[clf] :status :method :url :response-time ms", {
      stream: { write: (msg: string) => process.stdout.write(msg) },
    }),
  );

  // 7. Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // 8. Register auth routes (before middleware — no auth required)
  const authHandler = new AuthHandler(store, cfg.jwt_secret);
  registerAuthRoutes(app, authHandler);

  // 9. Auth middleware for protected routes
  const authMW = authMiddleware(cfg.jwt_secret);
  const adminMW = requireAdmin();

  // 10. Register admin routes (auth + admin required)
  const adminHandler = new AdminHandler(store, registry, migrator);
  registerAdminRoutes(app, adminHandler, authMW, adminMW);

  // 11. Register workflow runtime routes (auth required)
  const workflowHandler = new WorkflowHandler(store, registry);
  registerWorkflowRoutes(app, workflowHandler, authMW);

  // 12. Register dynamic entity routes (auth required)
  const engineHandler = new Handler(store, registry);
  registerDynamicRoutes(app, engineHandler, authMW);

  // 13. Error handler (must be last middleware)
  app.use(errorHandler);

  // 14. Start workflow scheduler
  const scheduler = new WorkflowScheduler(store, registry);
  scheduler.start();

  // 15. Start webhook retry scheduler
  const webhookScheduler = new WebhookScheduler(store);
  webhookScheduler.start();

  // 16. Start server
  const port = cfg.server.port;
  app.listen(port, () => {
    console.log(`Starting server on :${port}`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
