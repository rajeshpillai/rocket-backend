import type { AppManager } from "./manager.js";
import type { InstrumentationConfig } from "../config/index.js";
import { processWorkflowTimeouts } from "../engine/workflow-scheduler.js";
import { processWebhookRetries } from "../engine/webhook-scheduler.js";
import { cleanupOldEvents } from "../instrument/cleanup.js";

// MultiAppScheduler runs workflow timeouts, webhook retries, and event cleanup across all apps.
export class MultiAppScheduler {
  private manager: AppManager;
  private instrConfig: InstrumentationConfig;
  private workflowTimer: ReturnType<typeof setInterval> | null = null;
  private webhookTimer: ReturnType<typeof setInterval> | null = null;
  private eventCleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(manager: AppManager, instrConfig: InstrumentationConfig) {
    this.manager = manager;
    this.instrConfig = instrConfig;
  }

  start(): void {
    this.workflowTimer = setInterval(() => {
      this.processAllWorkflowTimeouts().catch((err) => {
        console.error("ERROR: multi-app workflow scheduler:", err);
      });
    }, 60_000);

    this.webhookTimer = setInterval(() => {
      this.processAllWebhookRetries().catch((err) => {
        console.error("ERROR: multi-app webhook scheduler:", err);
      });
    }, 30_000);

    // Event cleanup runs hourly
    if (this.instrConfig.enabled) {
      this.eventCleanupTimer = setInterval(() => {
        this.processAllEventCleanup().catch((err) => {
          console.error("ERROR: multi-app event cleanup:", err);
        });
      }, 3_600_000);
    }

    console.log("Multi-app scheduler started (workflows: 60s, webhooks: 30s, event cleanup: 1h)");
  }

  stop(): void {
    if (this.workflowTimer) {
      clearInterval(this.workflowTimer);
      this.workflowTimer = null;
    }
    if (this.webhookTimer) {
      clearInterval(this.webhookTimer);
      this.webhookTimer = null;
    }
    if (this.eventCleanupTimer) {
      clearInterval(this.eventCleanupTimer);
      this.eventCleanupTimer = null;
    }
  }

  private async processAllWorkflowTimeouts(): Promise<void> {
    for (const ac of this.manager.allContexts()) {
      try {
        await processWorkflowTimeouts(ac.store, ac.registry);
      } catch (err) {
        console.error(`ERROR: workflow timeouts for app ${ac.name}:`, err);
      }
    }
  }

  private async processAllWebhookRetries(): Promise<void> {
    for (const ac of this.manager.allContexts()) {
      try {
        await processWebhookRetries(ac.store);
      } catch (err) {
        console.error(`ERROR: webhook retries for app ${ac.name}:`, err);
      }
    }
  }

  private async processAllEventCleanup(): Promise<void> {
    for (const ac of this.manager.allContexts()) {
      try {
        const deleted = await cleanupOldEvents(ac.store.pool, this.instrConfig.retention_days);
        if (deleted > 0) {
          console.log(`Event cleanup for app ${ac.name}: deleted ${deleted} old events`);
        }
      } catch (err) {
        console.error(`ERROR: event cleanup for app ${ac.name}:`, err);
      }
    }
  }
}
