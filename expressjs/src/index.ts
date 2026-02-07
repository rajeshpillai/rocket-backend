import express from "express";
import morgan from "morgan";
import { loadConfig } from "./config/index.js";
import { Store } from "./store/postgres.js";
import { AppManager } from "./multiapp/manager.js";
import { platformBootstrap } from "./multiapp/platform-bootstrap.js";
import { PlatformHandler, registerPlatformRoutes } from "./multiapp/platform-handler.js";
import { platformAuthMiddleware } from "./multiapp/middleware.js";
import { registerAppRoutes } from "./multiapp/app-routes.js";
import { MultiAppScheduler } from "./multiapp/scheduler.js";
import { errorHandler } from "./middleware/error-handler.js";
import { LocalStorage } from "./storage/local.js";

async function main() {
  // 1. Load config
  const cfg = loadConfig();
  console.log(
    `Config loaded (port: ${cfg.server.port}, db: ${cfg.database.host}:${cfg.database.port}/${cfg.database.name})`,
  );

  // 2. Connect to management database
  const mgmtStore = await Store.connect(cfg.database);
  console.log("Management database connected");

  // 3. Bootstrap platform tables (_apps, _platform_users, _platform_refresh_tokens)
  await platformBootstrap(mgmtStore.pool);
  console.log("Platform tables ready");

  // 4. Create file storage
  const fileStorage = new LocalStorage(cfg.storage.local_path);

  // 5. Create AppManager and load all existing apps
  const manager = new AppManager(mgmtStore, cfg.database, cfg.app_pool_size, fileStorage, cfg.storage.max_file_size);
  try {
    await manager.loadAll();
  } catch (err) {
    console.warn("WARN: Failed to load apps:", err);
  }

  // 5. Create Express app
  const app = express();
  app.use(express.json());
  app.use(
    morgan(":date[clf] :status :method :url :response-time ms", {
      stream: { write: (msg: string) => process.stdout.write(msg) },
    }),
  );

  // 6. Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // 7. Platform routes (auth + app CRUD)
  const platformHandler = new PlatformHandler(mgmtStore, cfg.platform_jwt_secret, manager);
  const platformAuthMW = platformAuthMiddleware(cfg.platform_jwt_secret);
  registerPlatformRoutes(app, platformHandler, platformAuthMW);

  // 8. App-scoped routes (all existing CRUD/admin/auth/workflow routes under /api/:app)
  registerAppRoutes(app, manager, cfg.platform_jwt_secret);

  // 9. Error handler (must be last middleware)
  app.use(errorHandler);

  // 10. Start multi-app schedulers
  const scheduler = new MultiAppScheduler(manager);
  scheduler.start();

  // 11. Start server
  const port = cfg.server.port;
  app.listen(port, () => {
    console.log(`Starting server on :${port}`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
