import { Router } from "express";
import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { requireAdmin } from "../auth/middleware.js";
import { AppError } from "../engine/errors.js";
import { instrumentationMiddleware } from "../instrument/middleware.js";
import type { InstrumentationConfig } from "../config/index.js";
import type { AppManager } from "./manager.js";
import type { AppContext } from "./context.js";
import { appResolverMiddleware, appAuthMiddleware } from "./middleware.js";

const upload = multer({ storage: multer.memoryStorage() });

type HandlerFn = (req: Request, res: Response, next: NextFunction) => void;

// dispatch returns an Express handler that extracts the AppContext from the request
// and delegates to the handler function returned by fn.
function dispatch(fn: (ac: AppContext) => HandlerFn): HandlerFn {
  return (req: Request, res: Response, next: NextFunction) => {
    const ac = req.appCtx;
    if (!ac) {
      return next(new AppError("INTERNAL_ERROR", 500, "App context not found"));
    }
    fn(ac)(req, res, next);
  };
}

// registerAppRoutes registers all app-scoped routes under /api/:app.
export function registerAppRoutes(
  app: Express,
  manager: AppManager,
  platformJWTSecret: string,
  instrConfig: InstrumentationConfig,
): void {
  const resolverMW = appResolverMiddleware(manager);
  const appAuthMW = appAuthMiddleware(platformJWTSecret);
  const adminMW = requireAdmin();
  const instrMW = instrumentationMiddleware(instrConfig);

  // Auth routes (no auth required, only app resolver)
  const authRouter = Router({ mergeParams: true });
  authRouter.post("/login", dispatch((ac) => ac.authHandler.login));
  authRouter.post("/refresh", dispatch((ac) => ac.authHandler.refresh));
  authRouter.post("/logout", dispatch((ac) => ac.authHandler.logout));
  authRouter.post("/accept-invite", dispatch((ac) => ac.authHandler.acceptInvite));
  app.use("/api/:app/auth", resolverMW, instrMW, authRouter);

  // Admin routes (auth + admin required)
  const adminRouter = Router({ mergeParams: true });

  // Entities
  adminRouter.get("/entities", dispatch((ac) => ac.adminHandler.listEntities));
  adminRouter.get("/entities/:name", dispatch((ac) => ac.adminHandler.getEntity));
  adminRouter.post("/entities", dispatch((ac) => ac.adminHandler.createEntity));
  adminRouter.put("/entities/:name", dispatch((ac) => ac.adminHandler.updateEntity));
  adminRouter.delete("/entities/:name", dispatch((ac) => ac.adminHandler.deleteEntity));

  // Relations
  adminRouter.get("/relations", dispatch((ac) => ac.adminHandler.listRelations));
  adminRouter.get("/relations/:name", dispatch((ac) => ac.adminHandler.getRelation));
  adminRouter.post("/relations", dispatch((ac) => ac.adminHandler.createRelation));
  adminRouter.put("/relations/:name", dispatch((ac) => ac.adminHandler.updateRelation));
  adminRouter.delete("/relations/:name", dispatch((ac) => ac.adminHandler.deleteRelation));

  // Rules
  adminRouter.get("/rules", dispatch((ac) => ac.adminHandler.listRules));
  adminRouter.get("/rules/:id", dispatch((ac) => ac.adminHandler.getRule));
  adminRouter.post("/rules", dispatch((ac) => ac.adminHandler.createRule));
  adminRouter.put("/rules/:id", dispatch((ac) => ac.adminHandler.updateRule));
  adminRouter.delete("/rules/:id", dispatch((ac) => ac.adminHandler.deleteRule));

  // State Machines
  adminRouter.get("/state-machines", dispatch((ac) => ac.adminHandler.listStateMachines));
  adminRouter.get("/state-machines/:id", dispatch((ac) => ac.adminHandler.getStateMachine));
  adminRouter.post("/state-machines", dispatch((ac) => ac.adminHandler.createStateMachine));
  adminRouter.put("/state-machines/:id", dispatch((ac) => ac.adminHandler.updateStateMachine));
  adminRouter.delete("/state-machines/:id", dispatch((ac) => ac.adminHandler.deleteStateMachine));

  // Workflows
  adminRouter.get("/workflows", dispatch((ac) => ac.adminHandler.listWorkflows));
  adminRouter.get("/workflows/:id", dispatch((ac) => ac.adminHandler.getWorkflow));
  adminRouter.post("/workflows", dispatch((ac) => ac.adminHandler.createWorkflow));
  adminRouter.put("/workflows/:id", dispatch((ac) => ac.adminHandler.updateWorkflow));
  adminRouter.delete("/workflows/:id", dispatch((ac) => ac.adminHandler.deleteWorkflow));

  // Users
  adminRouter.get("/users", dispatch((ac) => ac.adminHandler.listUsers));
  adminRouter.get("/users/:id", dispatch((ac) => ac.adminHandler.getUser));
  adminRouter.post("/users", dispatch((ac) => ac.adminHandler.createUser));
  adminRouter.put("/users/:id", dispatch((ac) => ac.adminHandler.updateUser));
  adminRouter.delete("/users/:id", dispatch((ac) => ac.adminHandler.deleteUser));

  // Invites
  adminRouter.post("/invites/bulk", dispatch((ac) => ac.adminHandler.bulkCreateInvites));
  adminRouter.get("/invites", dispatch((ac) => ac.adminHandler.listInvites));
  adminRouter.post("/invites", dispatch((ac) => ac.adminHandler.createInvite));
  adminRouter.delete("/invites/:id", dispatch((ac) => ac.adminHandler.deleteInvite));

  // Permissions
  adminRouter.get("/permissions", dispatch((ac) => ac.adminHandler.listPermissions));
  adminRouter.get("/permissions/:id", dispatch((ac) => ac.adminHandler.getPermission));
  adminRouter.post("/permissions", dispatch((ac) => ac.adminHandler.createPermission));
  adminRouter.put("/permissions/:id", dispatch((ac) => ac.adminHandler.updatePermission));
  adminRouter.delete("/permissions/:id", dispatch((ac) => ac.adminHandler.deletePermission));

  // Webhooks
  adminRouter.get("/webhooks", dispatch((ac) => ac.adminHandler.listWebhooks));
  adminRouter.get("/webhooks/:id", dispatch((ac) => ac.adminHandler.getWebhook));
  adminRouter.post("/webhooks", dispatch((ac) => ac.adminHandler.createWebhook));
  adminRouter.put("/webhooks/:id", dispatch((ac) => ac.adminHandler.updateWebhook));
  adminRouter.delete("/webhooks/:id", dispatch((ac) => ac.adminHandler.deleteWebhook));

  // Webhook Logs
  adminRouter.get("/webhook-logs", dispatch((ac) => ac.adminHandler.listWebhookLogs));
  adminRouter.get("/webhook-logs/:id", dispatch((ac) => ac.adminHandler.getWebhookLog));
  adminRouter.post("/webhook-logs/:id/retry", dispatch((ac) => ac.adminHandler.retryWebhookLog));

  // UI Configs
  adminRouter.get("/ui-configs", dispatch((ac) => ac.adminHandler.listUIConfigs));
  adminRouter.get("/ui-configs/:id", dispatch((ac) => ac.adminHandler.getUIConfig));
  adminRouter.post("/ui-configs", dispatch((ac) => ac.adminHandler.createUIConfig));
  adminRouter.put("/ui-configs/:id", dispatch((ac) => ac.adminHandler.updateUIConfig));
  adminRouter.delete("/ui-configs/:id", dispatch((ac) => ac.adminHandler.deleteUIConfig));

  // Export/Import
  adminRouter.get("/export", dispatch((ac) => ac.adminHandler.export));
  adminRouter.post("/import", dispatch((ac) => ac.adminHandler.import));

  // AI Schema Generator
  adminRouter.get("/ai/status", (req: Request, res: Response, next: NextFunction) => {
    const ac = req.appCtx;
    if (!ac) return next(new AppError("INTERNAL_ERROR", 500, "App context not found"));
    if (!ac.aiHandler) {
      return res.json({ data: { configured: false, model: "" } });
    }
    ac.aiHandler.status(req, res, next);
  });
  adminRouter.post("/ai/generate", (req: Request, res: Response, next: NextFunction) => {
    const ac = req.appCtx;
    if (!ac) return next(new AppError("INTERNAL_ERROR", 500, "App context not found"));
    if (!ac.aiHandler) {
      return res.status(501).json({
        error: { code: "NOT_CONFIGURED", message: "AI not configured. Set ROCKET_AI_BASE_URL, ROCKET_AI_API_KEY, and ROCKET_AI_MODEL environment variables." },
      });
    }
    ac.aiHandler.generate(req, res, next);
  });

  app.use("/api/:app/_admin", resolverMW, appAuthMW, instrMW, adminMW, adminRouter);

  // UI config read routes (auth required, no admin)
  const uiRouter = Router({ mergeParams: true });
  uiRouter.get("/configs", dispatch((ac) => ac.adminHandler.listAllUIConfigs));
  uiRouter.get("/config/:entity", dispatch((ac) => ac.adminHandler.getUIConfigByEntity));
  app.use("/api/:app/_ui", resolverMW, appAuthMW, instrMW, uiRouter);

  // Workflow runtime routes (auth required)
  const wfRouter = Router({ mergeParams: true });
  wfRouter.get("/pending", dispatch((ac) => ac.workflowHandler.getPendingInstances));
  wfRouter.get("/:id", dispatch((ac) => ac.workflowHandler.getInstance));
  wfRouter.post("/:id/approve", dispatch((ac) => ac.workflowHandler.approveInstance));
  wfRouter.post("/:id/reject", dispatch((ac) => ac.workflowHandler.rejectInstance));
  wfRouter.delete("/:id", dispatch((ac) => ac.workflowHandler.deleteInstance));
  app.use("/api/:app/_workflows", resolverMW, appAuthMW, instrMW, wfRouter);

  // File routes (auth required, upload uses multer)
  const fileRouter = Router({ mergeParams: true });
  fileRouter.post("/upload", upload.single("file"), dispatch((ac) => ac.fileHandler.upload));
  fileRouter.get("/:id", dispatch((ac) => ac.fileHandler.serve));
  fileRouter.delete("/:id", adminMW, dispatch((ac) => ac.fileHandler.delete));
  fileRouter.get("/", adminMW, dispatch((ac) => ac.fileHandler.list));
  app.use("/api/:app/_files", resolverMW, appAuthMW, instrMW, fileRouter);

  // Event routes (auth required, list/trace/stats are admin-only)
  const eventRouter = Router({ mergeParams: true });
  eventRouter.post("/", dispatch((ac) => ac.eventHandler.emit));
  eventRouter.get("/trace/:traceId", adminMW, dispatch((ac) => ac.eventHandler.getTrace));
  eventRouter.get("/stats", adminMW, dispatch((ac) => ac.eventHandler.getStats));
  eventRouter.get("/", adminMW, dispatch((ac) => ac.eventHandler.list));
  app.use("/api/:app/_events", resolverMW, appAuthMW, instrMW, eventRouter);

  // Dynamic entity routes (must be last — catch-all pattern)
  const entityRouter = Router({ mergeParams: true });
  entityRouter.get("/:entity", dispatch((ac) => ac.engineHandler.list));
  entityRouter.get("/:entity/:id", dispatch((ac) => ac.engineHandler.getById));
  entityRouter.post("/:entity", dispatch((ac) => ac.engineHandler.create));
  entityRouter.put("/:entity/:id", dispatch((ac) => ac.engineHandler.update));
  entityRouter.delete("/:entity/:id", dispatch((ac) => ac.engineHandler.delete));
  app.use("/api/:app", resolverMW, appAuthMW, instrMW, entityRouter);
}
