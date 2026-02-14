import type { Store } from "../store/postgres.js";
import type { Registry } from "../metadata/registry.js";
import { WorkflowEngine } from "./workflow.js";

/**
 * WorkflowScheduler runs periodic timeout processing for workflow instances.
 * Delegates all logic to WorkflowEngine — no direct SQL or instance parsing.
 */
export class WorkflowScheduler {
  private engine: WorkflowEngine;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(store: Store, registry: Registry) {
    this.engine = WorkflowEngine.createDefault(store, registry);
  }

  start(): void {
    console.log("Workflow scheduler started (60s interval)");
    this.timer = setInterval(() => {
      this.engine.processTimeouts().catch((err) => {
        console.error("ERROR: workflow scheduler:", err);
      });
    }, 60_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("Workflow scheduler stopped");
    }
  }
}

/**
 * Runs workflow timeout processing once (used by multi-app scheduler).
 */
export async function processWorkflowTimeouts(store: Store, registry: Registry): Promise<void> {
  const engine = WorkflowEngine.createDefault(store, registry);
  await engine.processTimeouts();
}
