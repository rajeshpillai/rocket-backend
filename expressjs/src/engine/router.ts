import { Router, type Express } from "express";
import type { Handler } from "./handler.js";

export function registerDynamicRoutes(app: Express, handler: Handler): void {
  const api = Router();

  api.get("/:entity", handler.list);
  api.get("/:entity/:id", handler.getById);
  api.post("/:entity", handler.create);
  api.put("/:entity/:id", handler.update);
  api.delete("/:entity/:id", handler.delete);

  app.use("/api", api);
}
