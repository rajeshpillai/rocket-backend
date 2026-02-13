import type { Entity, Relation } from "./types.js";
import type { Rule } from "./rule.js";
import type { StateMachine } from "./state-machine.js";
import type { Workflow } from "./workflow.js";
import type { Permission } from "./permission.js";
import type { Webhook } from "./webhook.js";

export class Registry {
  private entities = new Map<string, Entity>();
  private relationsBySource = new Map<string, Relation[]>();
  private relationsByName = new Map<string, Relation>();
  private rulesByEntity = new Map<string, Rule[]>();
  private stateMachinesByEntity = new Map<string, StateMachine[]>();
  private workflowsByTrigger = new Map<string, Workflow[]>();
  private workflowsByName = new Map<string, Workflow>();
  private permissionsByEntityAction = new Map<string, Permission[]>();
  private webhooksByEntityHook = new Map<string, Webhook[]>();

  getEntity(name: string): Entity | undefined {
    return this.entities.get(name);
  }

  allEntities(): Entity[] {
    return Array.from(this.entities.values());
  }

  getRelation(name: string): Relation | undefined {
    return this.relationsByName.get(name);
  }

  getRelationsForSource(entityName: string): Relation[] {
    return this.relationsBySource.get(entityName) ?? [];
  }

  findRelationForEntity(
    relationName: string,
    entityName: string,
  ): Relation | undefined {
    const rel = this.relationsByName.get(relationName);
    if (rel && (rel.source === entityName || rel.target === entityName)) {
      return rel;
    }
    // Also search by target/source entity name as the include alias
    for (const r of this.relationsByName.values()) {
      if (r.source === entityName && r.target === relationName) {
        return r;
      }
      if (r.target === entityName && r.source === relationName) {
        return r;
      }
    }
    // Fallback: check for relation named "{entity}_{include}" (e.g. post_tags)
    return this.relationsByName.get(`${entityName}_${relationName}`);
  }

  allRelations(): Relation[] {
    return Array.from(this.relationsByName.values());
  }

  getRulesForEntity(entityName: string, hook: string): Rule[] {
    const all = this.rulesByEntity.get(entityName) ?? [];
    return all.filter((r) => r.active && r.hook === hook);
  }

  getStateMachinesForEntity(entityName: string): StateMachine[] {
    const all = this.stateMachinesByEntity.get(entityName) ?? [];
    return all.filter((sm) => sm.active);
  }

  loadStateMachines(machines: StateMachine[]): void {
    this.stateMachinesByEntity = new Map();
    for (const sm of machines) {
      const existing = this.stateMachinesByEntity.get(sm.entity) ?? [];
      existing.push(sm);
      this.stateMachinesByEntity.set(sm.entity, existing);
    }
  }

  getWorkflowsForTrigger(entity: string, field: string, toState: string): Workflow[] {
    const key = `${entity}:${field}:${toState}`;
    return this.workflowsByTrigger.get(key) ?? [];
  }

  getWorkflow(name: string): Workflow | undefined {
    return this.workflowsByName.get(name);
  }

  loadWorkflows(workflows: Workflow[]): void {
    this.workflowsByTrigger = new Map();
    this.workflowsByName = new Map();
    for (const wf of workflows) {
      if (!wf.active) continue;
      this.workflowsByName.set(wf.name, wf);
      if (wf.trigger.type === "state_change" && wf.trigger.entity && wf.trigger.field && wf.trigger.to) {
        const key = `${wf.trigger.entity}:${wf.trigger.field}:${wf.trigger.to}`;
        const existing = this.workflowsByTrigger.get(key) ?? [];
        existing.push(wf);
        this.workflowsByTrigger.set(key, existing);
      }
    }
  }

  loadRules(rules: Rule[]): void {
    this.rulesByEntity = new Map();
    for (const rule of rules) {
      const existing = this.rulesByEntity.get(rule.entity) ?? [];
      existing.push(rule);
      this.rulesByEntity.set(rule.entity, existing);
    }
    // Sort each entity's rules by priority
    for (const entityRules of this.rulesByEntity.values()) {
      entityRules.sort((a, b) => a.priority - b.priority);
    }
  }

  getPermissions(entity: string, action: string): Permission[] {
    return this.permissionsByEntityAction.get(`${entity}:${action}`) ?? [];
  }

  loadPermissions(permissions: Permission[]): void {
    this.permissionsByEntityAction = new Map();
    for (const p of permissions) {
      const key = `${p.entity}:${p.action}`;
      const existing = this.permissionsByEntityAction.get(key) ?? [];
      existing.push(p);
      this.permissionsByEntityAction.set(key, existing);
    }
  }

  getWebhooksForEntityHook(entity: string, hook: string): Webhook[] {
    const key = `${entity}:${hook}`;
    return (this.webhooksByEntityHook.get(key) ?? []).filter((wh) => wh.active);
  }

  loadWebhooks(webhooks: Webhook[]): void {
    this.webhooksByEntityHook = new Map();
    for (const wh of webhooks) {
      const key = `${wh.entity}:${wh.hook}`;
      const existing = this.webhooksByEntityHook.get(key) ?? [];
      existing.push(wh);
      this.webhooksByEntityHook.set(key, existing);
    }
  }

  load(entities: Entity[], relations: Relation[]): void {
    this.entities = new Map();
    for (const e of entities) {
      this.entities.set(e.name, e);
    }

    this.relationsBySource = new Map();
    this.relationsByName = new Map();
    for (const rel of relations) {
      this.relationsByName.set(rel.name, rel);
      const existing = this.relationsBySource.get(rel.source) ?? [];
      existing.push(rel);
      this.relationsBySource.set(rel.source, existing);
    }
  }
}
