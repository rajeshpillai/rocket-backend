import { Router } from "express";
import type { Express, Request, Response, NextFunction } from "express";
import { requireAdmin } from "../auth/middleware.js";
import { AppError } from "../engine/errors.js";
import type { AppManager } from "./manager.js";
import type { AppContext } from "./context.js";
import { appResolverMiddleware, appAuthMiddleware } from "./middleware.js";

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
): void {
  const resolverMW = appResolverMiddleware(manager);
  const appAuthMW = appAuthMiddleware(platformJWTSecret);
  const adminMW = requireAdmin();

  // Auth routes (no auth required, only app resolver)
  const authRouter = Router({ mergeParams: true });
  authRouter.post("/login", dispatch((ac) => ac.authHandler.login));
  authRouter.post("/refresh", dispatch((ac) => ac.authHandler.refresh));
  authRouter.post("/logout", dispatch((ac) => ac.authHandler.logout));
  app.use("/api/:app/auth", resolverMW, authRouter);

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

  app.use("/api/:app/_admin", resolverMW, appAuthMW, adminMW, adminRouter);

  // Workflow runtime routes (auth required)
  const wfRouter = Router({ mergeParams: true });
  wfRouter.get("/pending", dispatch((ac) => ac.workflowHandler.getPendingInstances));
  wfRouter.get("/:id", dispatch((ac) => ac.workflowHandler.getInstance));
  wfRouter.post("/:id/approve", dispatch((ac) => ac.workflowHandler.approveInstance));
  wfRouter.post("/:id/reject", dispatch((ac) => ac.workflowHandler.rejectInstance));
  app.use("/api/:app/_workflows", resolverMW, appAuthMW, wfRouter);

  // Dynamic entity routes (must be last — catch-all pattern)
  const entityRouter = Router({ mergeParams: true });
  entityRouter.get("/:entity", dispatch((ac) => ac.engineHandler.list));
  entityRouter.get("/:entity/:id", dispatch((ac) => ac.engineHandler.getById));
  entityRouter.post("/:entity", dispatch((ac) => ac.engineHandler.create));
  entityRouter.put("/:entity/:id", dispatch((ac) => ac.engineHandler.update));
  entityRouter.delete("/:entity/:id", dispatch((ac) => ac.engineHandler.delete));
  app.use("/api/:app", resolverMW, appAuthMW, entityRouter);
}
