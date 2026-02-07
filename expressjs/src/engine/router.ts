import { Router, type Express, type RequestHandler } from "express";
import type { Handler } from "./handler.js";

export function registerDynamicRoutes(
  app: Express,
  handler: Handler,
  ...middleware: RequestHandler[]
): void {
  const api = Router();

  api.get("/:entity", handler.list);
  api.get("/:entity/:id", handler.getById);
  api.post("/:entity", handler.create);
  api.put("/:entity/:id", handler.update);
  api.delete("/:entity/:id", handler.delete);

  app.use("/api", ...middleware, api);
}
