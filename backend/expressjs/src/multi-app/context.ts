import type { Store } from "../store/postgres.js";
import type { Registry } from "../metadata/registry.js";
import type { Migrator } from "../store/migrator.js";
import type { Handler } from "../engine/handler.js";
import type { AdminHandler } from "../admin/handler.js";
import type { AuthHandler } from "../auth/handler.js";
import type { WorkflowHandler } from "../engine/workflow-handler.js";
import type { FileHandler } from "../engine/file-handler.js";
import type { EventHandler } from "../instrument/handler.js";
import type { EventBuffer } from "../instrument/buffer.js";
import type { AIHandler } from "../ai/handler.js";

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
  fileHandler: FileHandler;
  eventHandler: EventHandler;
  eventBuffer: EventBuffer | null;
  aiHandler: AIHandler | null;
}

export interface AppInfo {
  name: string;
  display_name: string;
  db_name: string;
  db_driver: string;
  status: string;
  created_at: any;
  updated_at: any;
}
