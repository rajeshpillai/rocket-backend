import type { AppManager } from "./manager.js";
import { processWorkflowTimeouts } from "../engine/workflow-scheduler.js";
import { processWebhookRetries } from "../engine/webhook-scheduler.js";

// MultiAppScheduler runs workflow timeouts and webhook retries across all apps.
export class MultiAppScheduler {
  private manager: AppManager;
  private workflowTimer: ReturnType<typeof setInterval> | null = null;
  private webhookTimer: ReturnType<typeof setInterval> | null = null;

  constructor(manager: AppManager) {
    this.manager = manager;
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

    console.log("Multi-app scheduler started (workflows: 60s, webhooks: 30s)");
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
}
