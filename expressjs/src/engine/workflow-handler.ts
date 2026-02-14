import { Router, type Express, type Request, type Response, type NextFunction, type RequestHandler } from "express";
import type { Store } from "../store/postgres.js";
import type { Registry } from "../metadata/registry.js";
import { AppError } from "./errors.js";
import {
  resolveWorkflowAction,
  loadWorkflowInstance,
  listPendingInstances,
} from "./workflow.js";
import { getInstrumenter } from "../instrument/instrument.js";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export class WorkflowHandler {
  private store: Store;
  private registry: Registry;

  constructor(store: Store, registry: Registry) {
    this.store = store;
    this.registry = registry;
  }

  getPendingInstances = asyncHandler(async (_req: Request, res: Response) => {
    const instances = await listPendingInstances(this.store);
    res.json({ data: instances });
  });

  getInstance = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      const instance = await loadWorkflowInstance(this.store, id);
      res.json({ data: instance });
    } catch {
      throw new AppError("NOT_FOUND", 404, `Workflow instance not found: ${id}`);
    }
  });

  approveInstance = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    const userID = (req.headers["x-user-id"] as string) || "system";
    const span = getInstrumenter().startSpan("workflow", "handler", "workflow.approve");
    span.setMetadata("instance_id", id);
    span.setMetadata("user_id", userID);
    try {
      const instance = await resolveWorkflowAction(
        this.store,
        this.registry,
        id,
        "approved",
        userID,
      );
      span.setStatus("ok");
      res.json({ data: instance });
    } catch (err: any) {
      span.setStatus("error");
      span.setMetadata("error", err.message);
      if (err.message?.includes("not found")) {
        throw new AppError("NOT_FOUND", 404, err.message);
      }
      if (err.message?.includes("not running") || err.message?.includes("not an approval")) {
        throw new AppError("INVALID_STATE", 422, err.message);
      }
      throw err;
    } finally {
      span.end();
    }
  });

  rejectInstance = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    const userID = (req.headers["x-user-id"] as string) || "system";
    const span = getInstrumenter().startSpan("workflow", "handler", "workflow.reject");
    span.setMetadata("instance_id", id);
    span.setMetadata("user_id", userID);
    try {
      const instance = await resolveWorkflowAction(
        this.store,
        this.registry,
        id,
        "rejected",
        userID,
      );
      span.setStatus("ok");
      res.json({ data: instance });
    } catch (err: any) {
      span.setStatus("error");
      span.setMetadata("error", err.message);
      if (err.message?.includes("not found")) {
        throw new AppError("NOT_FOUND", 404, err.message);
      }
      if (err.message?.includes("not running") || err.message?.includes("not an approval")) {
        throw new AppError("INVALID_STATE", 422, err.message);
      }
      throw err;
    } finally {
      span.end();
    }
  });
}

export function registerWorkflowRoutes(
  app: Express,
  handler: WorkflowHandler,
  ...middleware: RequestHandler[]
): void {
  const router = Router();

  router.get("/pending", handler.getPendingInstances);
  router.get("/:id", handler.getInstance);
  router.post("/:id/approve", handler.approveInstance);
  router.post("/:id/reject", handler.rejectInstance);

  app.use("/api/_workflows", ...middleware, router);
}
