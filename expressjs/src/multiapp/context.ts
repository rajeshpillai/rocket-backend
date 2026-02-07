import type { Store } from "../store/postgres.js";
import type { Registry } from "../metadata/registry.js";
import type { Migrator } from "../store/migrator.js";
import type { Handler } from "../engine/handler.js";
import type { AdminHandler } from "../admin/handler.js";
import type { AuthHandler } from "../auth/handler.js";
import type { WorkflowHandler } from "../engine/workflow-handler.js";

export interface AppContext {
  name: string;
  dbName: string;
  jwtSecret: string;
  store: Store;
  registry: Registry;
  migrator: Migrator;
  engineHandler: Handler;
  adminHandler: AdminHandler;
  authHandler: AuthHandler;
  workflowHandler: WorkflowHandler;
}

export interface AppInfo {
  name: string;
  display_name: string;
  db_name: string;
  status: string;
  created_at: any;
  updated_at: any;
}
