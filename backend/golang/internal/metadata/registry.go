package metadata

import (
	"sort"
	"sync"
)

type Registry struct {
	mu                      sync.RWMutex
	entities                map[string]*Entity
	relationsBySource       map[string][]*Relation       // keyed by source entity name
	relationsByName         map[string]*Relation         // keyed by relation name
	rulesByEntity           map[string][]*Rule           // keyed by entity name, sorted by priority
	stateMachinesByEntity   map[string][]*StateMachine   // keyed by entity name
	workflowsByTrigger        map[string][]*Workflow       // keyed by "entity:field:toState"
	workflowsByName           map[string]*Workflow         // keyed by workflow name
	permissionsByEntityAction map[string][]*Permission     // keyed by "entity:action"
	webhooksByEntityHook     map[string][]*Webhook        // keyed by "entity:hook"
}

func NewRegistry() *Registry {
	return &Registry{
		entities:              make(map[string]*Entity),
		relationsBySource:     make(map[string][]*Relation),
		relationsByName:       make(map[string]*Relation),
		rulesByEntity:         make(map[string][]*Rule),
		stateMachinesByEntity: make(map[string][]*StateMachine),
		workflowsByTrigger:        make(map[string][]*Workflow),
		workflowsByName:           make(map[string]*Workflow),
		permissionsByEntityAction: make(map[string][]*Permission),
		webhooksByEntityHook:     make(map[string][]*Webhook),
	}
}

// GetEntity returns the entity with the given name, or nil.
func (r *Registry) GetEntity(name string) *Entity {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.entities[name]
}

// AllEntities returns all registered entities.
func (r *Registry) AllEntities() []*Entity {
	r.mu.RLock()
	defer r.mu.RUnlock()
	entities := make([]*Entity, 0, len(r.entities))
	for _, e := range r.entities {
		entities = append(entities, e)
	}
	return entities
}

// GetRelation returns a relation by name, or nil.
func (r *Registry) GetRelation(name string) *Relation {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.relationsByName[name]
}

// GetRelationsForSource returns all relations where source matches the given entity.
func (r *Registry) GetRelationsForSource(entityName string) []*Relation {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.relationsBySource[entityName]
}

// FindRelationForEntity finds a relation by name that involves the given entity
// (as source or target). Used for resolving include params.
func (r *Registry) FindRelationForEntity(relationName string, entityName string) *Relation {
	r.mu.RLock()
	defer r.mu.RUnlock()
	rel := r.relationsByName[relationName]
	if rel != nil && (rel.Source == entityName || rel.Target == entityName) {
		return rel
	}
	// Also search by target entity name as the include alias
	for _, rel := range r.relationsByName {
		if rel.Source == entityName && rel.Target == relationName {
			return rel
		}
		if rel.Target == entityName && rel.Source == relationName {
			return rel
		}
	}
	// Fallback: check for relation named "{entity}_{include}" (e.g. post_tags)
	return r.relationsByName[entityName+"_"+relationName]
}

// AllRelations returns all registered relations.
func (r *Registry) AllRelations() []*Relation {
	r.mu.RLock()
	defer r.mu.RUnlock()
	relations := make([]*Relation, 0, len(r.relationsByName))
	for _, rel := range r.relationsByName {
		relations = append(relations, rel)
	}
	return relations
}

// GetRulesForEntity returns active rules for an entity and hook, sorted by priority.
func (r *Registry) GetRulesForEntity(entityName, hook string) []*Rule {
	r.mu.RLock()
	defer r.mu.RUnlock()
	all := r.rulesByEntity[entityName]
	var result []*Rule
	for _, rule := range all {
		if rule.Active && rule.Hook == hook {
			result = append(result, rule)
		}
	}
	return result
}

// Load replaces all entities and relations in the registry.
// Called during startup and after admin mutations.
func (r *Registry) Load(entities []*Entity, relations []*Relation) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.entities = make(map[string]*Entity, len(entities))
	for _, e := range entities {
		r.entities[e.Name] = e
	}

	r.relationsBySource = make(map[string][]*Relation)
	r.relationsByName = make(map[string]*Relation, len(relations))
	for _, rel := range relations {
		r.relationsByName[rel.Name] = rel
		r.relationsBySource[rel.Source] = append(r.relationsBySource[rel.Source], rel)
	}
}

// GetStateMachinesForEntity returns active state machines for an entity.
func (r *Registry) GetStateMachinesForEntity(entityName string) []*StateMachine {
	r.mu.RLock()
	defer r.mu.RUnlock()
	all := r.stateMachinesByEntity[entityName]
	var result []*StateMachine
	for _, sm := range all {
		if sm.Active {
			result = append(result, sm)
		}
	}
	return result
}

// LoadStateMachines replaces all state machines in the registry.
func (r *Registry) LoadStateMachines(machines []*StateMachine) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.stateMachinesByEntity = make(map[string][]*StateMachine)
	for _, sm := range machines {
		r.stateMachinesByEntity[sm.Entity] = append(r.stateMachinesByEntity[sm.Entity], sm)
	}
}

// GetWorkflowsForTrigger returns active workflows matching the given trigger key.
func (r *Registry) GetWorkflowsForTrigger(entity, field, toState string) []*Workflow {
	r.mu.RLock()
	defer r.mu.RUnlock()
	key := entity + ":" + field + ":" + toState
	all := r.workflowsByTrigger[key]
	var result []*Workflow
	for _, wf := range all {
		if wf.Active {
			result = append(result, wf)
		}
	}
	return result
}

// GetWorkflow returns a workflow by name, or nil.
func (r *Registry) GetWorkflow(name string) *Workflow {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.workflowsByName[name]
}

// LoadWorkflows replaces all workflows in the registry.
func (r *Registry) LoadWorkflows(workflows []*Workflow) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.workflowsByTrigger = make(map[string][]*Workflow)
	r.workflowsByName = make(map[string]*Workflow, len(workflows))
	for _, wf := range workflows {
		r.workflowsByName[wf.Name] = wf
		if wf.Trigger.Type == "state_change" {
			key := wf.Trigger.Entity + ":" + wf.Trigger.Field + ":" + wf.Trigger.To
			r.workflowsByTrigger[key] = append(r.workflowsByTrigger[key], wf)
		}
	}
}

// GetPermissions returns all permissions for an entity + action pair.
func (r *Registry) GetPermissions(entity, action string) []*Permission {
	r.mu.RLock()
	defer r.mu.RUnlock()
	key := entity + ":" + action
	return r.permissionsByEntityAction[key]
}

// LoadPermissions replaces all permissions in the registry.
func (r *Registry) LoadPermissions(permissions []*Permission) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.permissionsByEntityAction = make(map[string][]*Permission)
	for _, p := range permissions {
		key := p.Entity + ":" + p.Action
		r.permissionsByEntityAction[key] = append(r.permissionsByEntityAction[key], p)
	}
}

// GetWebhooksForEntityHook returns active webhooks for an entity + hook combination.
func (r *Registry) GetWebhooksForEntityHook(entity, hook string) []*Webhook {
	r.mu.RLock()
	defer r.mu.RUnlock()
	key := entity + ":" + hook
	all := r.webhooksByEntityHook[key]
	var result []*Webhook
	for _, wh := range all {
		if wh.Active {
			result = append(result, wh)
		}
	}
	return result
}

// LoadWebhooks replaces all webhooks in the registry.
func (r *Registry) LoadWebhooks(webhooks []*Webhook) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.webhooksByEntityHook = make(map[string][]*Webhook)
	for _, wh := range webhooks {
		key := wh.Entity + ":" + wh.Hook
		r.webhooksByEntityHook[key] = append(r.webhooksByEntityHook[key], wh)
	}
}

// LoadRules replaces all rules in the registry, sorted by priority.
func (r *Registry) LoadRules(rules []*Rule) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.rulesByEntity = make(map[string][]*Rule)
	for _, rule := range rules {
		r.rulesByEntity[rule.Entity] = append(r.rulesByEntity[rule.Entity], rule)
	}
	// Sort each entity's rules by priority
	for _, entityRules := range r.rulesByEntity {
		sort.Slice(entityRules, func(i, j int) bool {
			return entityRules[i].Priority < entityRules[j].Priority
		})
	}
}
