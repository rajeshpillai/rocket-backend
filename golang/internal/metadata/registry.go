package metadata

import "sync"

type Registry struct {
	mu           sync.RWMutex
	entities     map[string]*Entity
	relationsBySource map[string][]*Relation // keyed by source entity name
	relationsByName   map[string]*Relation   // keyed by relation name
}

func NewRegistry() *Registry {
	return &Registry{
		entities:          make(map[string]*Entity),
		relationsBySource: make(map[string][]*Relation),
		relationsByName:   make(map[string]*Relation),
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
	return nil
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
