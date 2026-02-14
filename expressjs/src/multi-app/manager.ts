import { randomBytes } from "node:crypto";
import type { DatabaseConfig, InstrumentationConfig } from "../config/index.js";
import { Store, queryRows, queryRow, getDialect } from "../store/postgres.js";
import { bootstrap } from "../store/bootstrap.js";
import { Migrator } from "../store/migrator.js";
import { Registry } from "../metadata/registry.js";
import { loadAll } from "../metadata/loader.js";
import { Handler } from "../engine/handler.js";
import { AdminHandler } from "../admin/handler.js";
import { AuthHandler } from "../auth/handler.js";
import { WorkflowHandler } from "../engine/workflow-handler.js";
import { FileHandler } from "../engine/file-handler.js";
import type { FileStorage } from "../storage/storage.js";
import { EventBuffer } from "../instrument/buffer.js";
import { EventHandler } from "../instrument/handler.js";
import type { AppContext, AppInfo } from "./context.js";

export class AppManager {
  private apps = new Map<string, AppContext>();
  private initializing = new Map<string, Promise<AppContext>>();
  private mgmtStore: Store;
  private dbConfig: DatabaseConfig;
  private poolSize: number;
  private fileStorage: FileStorage;
  private maxFileSize: number;
  private instrConfig: InstrumentationConfig;

  constructor(mgmtStore: Store, dbConfig: DatabaseConfig, appPoolSize: number, fileStorage: FileStorage, maxFileSize: number, instrConfig: InstrumentationConfig) {
    this.mgmtStore = mgmtStore;
    this.dbConfig = dbConfig;
    this.poolSize = appPoolSize;
    this.fileStorage = fileStorage;
    this.maxFileSize = maxFileSize;
    this.instrConfig = instrConfig;
  }

  async get(appName: string): Promise<AppContext | null> {
    const cached = this.apps.get(appName);
    if (cached) return cached;

    // Guard against concurrent initialization for the same app
    const inflight = this.initializing.get(appName);
    if (inflight) return inflight;

    const promise = this.initApp(appName);
    this.initializing.set(appName, promise);
    try {
      const ac = await promise;
      return ac;
    } finally {
      this.initializing.delete(appName);
    }
  }

  async create(name: string, displayName: string, dbDriver: string = "postgres"): Promise<AppContext> {
    const dbName = "rocket_" + name;
    const jwtSecret = generateJWTSecret();

    // Create the database
    await getDialect().createDatabase(this.mgmtStore.pool, dbName, this.dbConfig.data_dir);

    // Register in _apps
    try {
      await this.mgmtStore.pool.query(
        "INSERT INTO _apps (name, display_name, db_name, jwt_secret, db_driver) VALUES ($1, $2, $3, $4, $5)",
        [name, displayName, dbName, jwtSecret, dbDriver],
      );
    } catch (err) {
      await getDialect().dropDatabase(this.mgmtStore.pool, dbName, this.dbConfig.data_dir);
      throw err;
    }

    // Connect to new database
    const appStore = await Store.connectToDB(this.dbConfig, dbName, this.poolSize);

    // Bootstrap system tables + seed admin
    await bootstrap(appStore.pool);

    // Load metadata
    const registry = new Registry();
    await loadAll(appStore.pool, registry);

    // Build handlers
    const migrator = new Migrator(appStore);
    const eventBuffer = this.instrConfig.enabled
      ? new EventBuffer(appStore.pool, this.instrConfig.buffer_size, this.instrConfig.flush_interval_ms)
      : null;
    const ac: AppContext = {
      name,
      dbName,
      jwtSecret,
      store: appStore,
      registry,
      migrator,
      engineHandler: new Handler(appStore, registry),
      adminHandler: new AdminHandler(appStore, registry, migrator),
      authHandler: new AuthHandler(appStore, jwtSecret),
      workflowHandler: new WorkflowHandler(appStore, registry),
      fileHandler: new FileHandler(appStore, this.fileStorage, this.maxFileSize, name),
      eventHandler: new EventHandler(appStore.pool),
      eventBuffer,
    };

    this.apps.set(name, ac);
    return ac;
  }

  async delete(name: string): Promise<void> {
    const ac = this.apps.get(name);
    if (ac) {
      ac.eventBuffer?.stop();
      await ac.store.close();
      this.apps.delete(name);
    }

    // Look up db_name
    const rows = await queryRows(
      this.mgmtStore.pool,
      "SELECT db_name FROM _apps WHERE name = $1",
      [name],
    );
    if (rows.length === 0) {
      throw new Error(`App not found: ${name}`);
    }
    const dbName = rows[0].db_name as string;

    // Remove from _apps
    await this.mgmtStore.pool.query("DELETE FROM _apps WHERE name = $1", [name]);

    // Drop the database
    await getDialect().dropDatabase(this.mgmtStore.pool, dbName, this.dbConfig.data_dir);
  }

  async list(): Promise<AppInfo[]> {
    const rows = await queryRows(
      this.mgmtStore.pool,
      "SELECT name, display_name, db_name, db_driver, status, created_at, updated_at FROM _apps ORDER BY name",
    );
    return rows.map((row) => ({
      name: row.name as string,
      display_name: row.display_name as string,
      db_name: row.db_name as string,
      db_driver: (row.db_driver as string) || "postgres",
      status: row.status as string,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  async getApp(name: string): Promise<AppInfo> {
    const row = await queryRow(
      this.mgmtStore.pool,
      "SELECT name, display_name, db_name, db_driver, status, created_at, updated_at FROM _apps WHERE name = $1",
      [name],
    );
    return {
      name: row.name as string,
      display_name: row.display_name as string,
      db_name: row.db_name as string,
      db_driver: (row.db_driver as string) || "postgres",
      status: row.status as string,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  async loadAll(): Promise<void> {
    let rows: Record<string, any>[];
    try {
      rows = await queryRows(
        this.mgmtStore.pool,
        "SELECT name, db_name, jwt_secret, db_driver FROM _apps WHERE status = 'active'",
      );
    } catch {
      return; // No apps yet
    }

    for (const row of rows) {
      const name = row.name as string;
      const dbName = row.db_name as string;
      const jwtSecret = row.jwt_secret as string;

      try {
        const appStore = await Store.connectToDB(this.dbConfig, dbName, this.poolSize);
        await bootstrap(appStore.pool); // idempotent

        const registry = new Registry();
        await loadAll(appStore.pool, registry);

        const migrator = new Migrator(appStore);
        const eventBuffer = this.instrConfig.enabled
          ? new EventBuffer(appStore.pool, this.instrConfig.buffer_size, this.instrConfig.flush_interval_ms)
          : null;
        const ac: AppContext = {
          name,
          dbName,
          jwtSecret,
          store: appStore,
          registry,
          migrator,
          engineHandler: new Handler(appStore, registry),
          adminHandler: new AdminHandler(appStore, registry, migrator),
          authHandler: new AuthHandler(appStore, jwtSecret),
          workflowHandler: new WorkflowHandler(appStore, registry),
          fileHandler: new FileHandler(appStore, this.fileStorage, this.maxFileSize, name),
          eventHandler: new EventHandler(appStore.pool),
          eventBuffer,
        };

        this.apps.set(name, ac);
        console.log(`App loaded: ${name} (db: ${dbName})`);
      } catch (err) {
        console.warn(`WARN: Failed to load app ${name}: ${err}`);
      }
    }
  }

  allContexts(): AppContext[] {
    return Array.from(this.apps.values());
  }

  async close(): Promise<void> {
    for (const ac of this.apps.values()) {
      ac.eventBuffer?.stop();
      await ac.store.close();
    }
    this.apps.clear();
  }

  private async initApp(appName: string): Promise<AppContext> {
    let rows: Record<string, any>[];
    try {
      rows = await queryRows(
        this.mgmtStore.pool,
        "SELECT db_name, jwt_secret, status FROM _apps WHERE name = $1",
        [appName],
      );
    } catch {
      throw new Error(`App not found: ${appName}`);
    }
    if (rows.length === 0) {
      throw new Error(`App not found: ${appName}`);
    }
    const { db_name: dbName, jwt_secret: jwtSecret, status } = rows[0];
    if (status !== "active") {
      throw new Error(`App ${appName} is ${status}`);
    }

    const appStore = await Store.connectToDB(this.dbConfig, dbName as string, this.poolSize);

    const registry = new Registry();
    await loadAll(appStore.pool, registry);

    const migrator = new Migrator(appStore);
    const eventBuffer = this.instrConfig.enabled
      ? new EventBuffer(appStore.pool, this.instrConfig.buffer_size, this.instrConfig.flush_interval_ms)
      : null;
    const ac: AppContext = {
      name: appName,
      dbName: dbName as string,
      jwtSecret: jwtSecret as string,
      store: appStore,
      registry,
      migrator,
      engineHandler: new Handler(appStore, registry),
      adminHandler: new AdminHandler(appStore, registry, migrator),
      authHandler: new AuthHandler(appStore, jwtSecret as string),
      workflowHandler: new WorkflowHandler(appStore, registry),
      fileHandler: new FileHandler(appStore, this.fileStorage, this.maxFileSize, appName),
      eventHandler: new EventHandler(appStore.pool),
      eventBuffer,
    };

    this.apps.set(appName, ac);
    return ac;
  }
}

function generateJWTSecret(): string {
  return randomBytes(32).toString("hex");
}
