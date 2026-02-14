package metadata

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
)

// LoadAll reads all entities and relations from the database and populates the registry.
func LoadAll(ctx context.Context, db *sql.DB, reg *Registry) error {
	entities, err := loadEntities(ctx, db)
	if err != nil {
		return fmt.Errorf("load entities: %w", err)
	}

	relations, err := loadRelations(ctx, db)
	if err != nil {
		return fmt.Errorf("load relations: %w", err)
	}

	reg.Load(entities, relations)

	rules, err := loadRules(ctx, db)
	if err != nil {
		return fmt.Errorf("load rules: %w", err)
	}
	reg.LoadRules(rules)

	machines, err := loadStateMachines(ctx, db)
	if err != nil {
		return fmt.Errorf("load state machines: %w", err)
	}
	reg.LoadStateMachines(machines)

	workflows, err := loadWorkflows(ctx, db)
	if err != nil {
		return fmt.Errorf("load workflows: %w", err)
	}
	reg.LoadWorkflows(workflows)

	permissions, err := loadPermissions(ctx, db)
	if err != nil {
		return fmt.Errorf("load permissions: %w", err)
	}
	reg.LoadPermissions(permissions)

	webhooks, err := loadWebhooks(ctx, db)
	if err != nil {
		return fmt.Errorf("load webhooks: %w", err)
	}
	reg.LoadWebhooks(webhooks)

	log.Printf("Loaded %d entities, %d relations, %d rules, %d state machines, %d workflows, %d permissions, %d webhooks into registry",
		len(entities), len(relations), len(rules), len(machines), len(workflows), len(permissions), len(webhooks))
	return nil
}

// Reload is an alias for LoadAll, called after admin mutations.
func Reload(ctx context.Context, db *sql.DB, reg *Registry) error {
	return LoadAll(ctx, db, reg)
}

func loadEntities(ctx context.Context, db *sql.DB) ([]*Entity, error) {
	rows, err := db.QueryContext(ctx, "SELECT name, definition FROM _entities ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entities []*Entity
	for rows.Next() {
		var name string
		var defJSON []byte
		if err := rows.Scan(&name, &defJSON); err != nil {
			return nil, fmt.Errorf("scan entity row: %w", err)
		}

		var entity Entity
		if err := json.Unmarshal(defJSON, &entity); err != nil {
			log.Printf("WARN: skipping entity %s (invalid JSON): %v", name, err)
			continue
		}
		entities = append(entities, &entity)
	}
	return entities, rows.Err()
}

func loadRelations(ctx context.Context, db *sql.DB) ([]*Relation, error) {
	rows, err := db.QueryContext(ctx, "SELECT name, definition FROM _relations ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var relations []*Relation
	for rows.Next() {
		var name string
		var defJSON []byte
		if err := rows.Scan(&name, &defJSON); err != nil {
			return nil, fmt.Errorf("scan relation row: %w", err)
		}

		var rel Relation
		if err := json.Unmarshal(defJSON, &rel); err != nil {
			log.Printf("WARN: skipping relation %s (invalid JSON): %v", name, err)
			continue
		}
		relations = append(relations, &rel)
	}
	return relations, rows.Err()
}

func loadRules(ctx context.Context, db *sql.DB) ([]*Rule, error) {
	rows, err := db.QueryContext(ctx,
		"SELECT id, entity, hook, type, definition, priority, active FROM _rules ORDER BY entity, priority")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []*Rule
	for rows.Next() {
		var r Rule
		var defJSON []byte
		var active any
		if err := rows.Scan(&r.ID, &r.Entity, &r.Hook, &r.Type, &defJSON, &r.Priority, &active); err != nil {
			return nil, fmt.Errorf("scan rule row: %w", err)
		}
		r.Active = toBool(active)
		if err := json.Unmarshal(defJSON, &r.Definition); err != nil {
			log.Printf("WARN: skipping rule %s (invalid JSON): %v", r.ID, err)
			continue
		}
		rules = append(rules, &r)
	}
	return rules, rows.Err()
}

func loadStateMachines(ctx context.Context, db *sql.DB) ([]*StateMachine, error) {
	rows, err := db.QueryContext(ctx,
		"SELECT id, entity, field, definition, active FROM _state_machines ORDER BY entity")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var machines []*StateMachine
	for rows.Next() {
		var sm StateMachine
		var defJSON []byte
		var active any
		if err := rows.Scan(&sm.ID, &sm.Entity, &sm.Field, &defJSON, &active); err != nil {
			return nil, fmt.Errorf("scan state machine row: %w", err)
		}
		sm.Active = toBool(active)
		if err := json.Unmarshal(defJSON, &sm.Definition); err != nil {
			log.Printf("WARN: skipping state machine %s (invalid JSON): %v", sm.ID, err)
			continue
		}
		machines = append(machines, &sm)
	}
	return machines, rows.Err()
}

func loadWorkflows(ctx context.Context, db *sql.DB) ([]*Workflow, error) {
	rows, err := db.QueryContext(ctx,
		"SELECT id, name, trigger, context, steps, active FROM _workflows ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var workflows []*Workflow
	for rows.Next() {
		var wf Workflow
		var triggerJSON, contextJSON, stepsJSON []byte
		var active any
		if err := rows.Scan(&wf.ID, &wf.Name, &triggerJSON, &contextJSON, &stepsJSON, &active); err != nil {
			return nil, fmt.Errorf("scan workflow row: %w", err)
		}
		wf.Active = toBool(active)
		if err := json.Unmarshal(triggerJSON, &wf.Trigger); err != nil {
			log.Printf("WARN: skipping workflow %s (invalid trigger JSON): %v", wf.Name, err)
			continue
		}
		if err := json.Unmarshal(contextJSON, &wf.Context); err != nil {
			log.Printf("WARN: skipping workflow %s (invalid context JSON): %v", wf.Name, err)
			continue
		}
		if err := json.Unmarshal(stepsJSON, &wf.Steps); err != nil {
			log.Printf("WARN: skipping workflow %s (invalid steps JSON): %v", wf.Name, err)
			continue
		}
		workflows = append(workflows, &wf)
	}
	return workflows, rows.Err()
}

func loadWebhooks(ctx context.Context, db *sql.DB) ([]*Webhook, error) {
	rows, err := db.QueryContext(ctx,
		"SELECT id, entity, hook, url, method, headers, condition, async, retry, active FROM _webhooks ORDER BY entity, hook")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var webhooks []*Webhook
	for rows.Next() {
		var wh Webhook
		var headersJSON, retryJSON []byte
		var asyncVal, activeVal any
		if err := rows.Scan(&wh.ID, &wh.Entity, &wh.Hook, &wh.URL, &wh.Method, &headersJSON, &wh.Condition, &asyncVal, &retryJSON, &activeVal); err != nil {
			return nil, fmt.Errorf("scan webhook row: %w", err)
		}
		wh.Async = toBool(asyncVal)
		wh.Active = toBool(activeVal)
		if headersJSON != nil && len(headersJSON) > 0 {
			if err := json.Unmarshal(headersJSON, &wh.Headers); err != nil {
				log.Printf("WARN: skipping webhook %s (invalid headers JSON): %v", wh.ID, err)
				continue
			}
		}
		if wh.Headers == nil {
			wh.Headers = make(map[string]string)
		}
		if retryJSON != nil && len(retryJSON) > 0 {
			if err := json.Unmarshal(retryJSON, &wh.Retry); err != nil {
				log.Printf("WARN: skipping webhook %s (invalid retry JSON): %v", wh.ID, err)
				continue
			}
		}
		webhooks = append(webhooks, &wh)
	}
	return webhooks, rows.Err()
}

func loadPermissions(ctx context.Context, db *sql.DB) ([]*Permission, error) {
	rows, err := db.QueryContext(ctx,
		"SELECT id, entity, action, roles, conditions FROM _permissions ORDER BY entity, action")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var permissions []*Permission
	for rows.Next() {
		var p Permission
		var condJSON []byte
		var rolesRaw any
		if err := rows.Scan(&p.ID, &p.Entity, &p.Action, &rolesRaw, &condJSON); err != nil {
			return nil, fmt.Errorf("scan permission row: %w", err)
		}
		p.Roles = ParseStringArray(rolesRaw)
		if condJSON != nil && len(condJSON) > 0 {
			if err := json.Unmarshal(condJSON, &p.Conditions); err != nil {
				log.Printf("WARN: skipping permission %s (invalid conditions JSON): %v", p.ID, err)
				continue
			}
		}
		permissions = append(permissions, &p)
	}
	return permissions, rows.Err()
}

// toBool converts any value to bool, handling SQLite integer booleans.
func toBool(v any) bool {
	if v == nil {
		return false
	}
	switch val := v.(type) {
	case bool:
		return val
	case int64:
		return val != 0
	case int:
		return val != 0
	case float64:
		return val != 0
	default:
		return false
	}
}

// ParseStringArray decodes TEXT[] (PostgreSQL) or JSON string (SQLite) into []string.
func ParseStringArray(v any) []string {
	if v == nil {
		return []string{}
	}
	switch val := v.(type) {
	case []string:
		return val
	case []any:
		result := make([]string, 0, len(val))
		for _, item := range val {
			if s, ok := item.(string); ok {
				result = append(result, s)
			}
		}
		return result
	case []byte:
		return parseStringArrayFromBytes(string(val))
	case string:
		return parseStringArrayFromBytes(val)
	default:
		return []string{}
	}
}

// parseStringArrayFromBytes handles both PostgreSQL {a,b,c} and JSON ["a","b","c"] formats.
func parseStringArrayFromBytes(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" || s == "{}" || s == "[]" {
		return []string{}
	}

	// Try JSON array first
	if strings.HasPrefix(s, "[") {
		var arr []string
		if err := json.Unmarshal([]byte(s), &arr); err == nil {
			return arr
		}
	}

	// PostgreSQL TEXT[] format: {admin,user}
	if strings.HasPrefix(s, "{") && strings.HasSuffix(s, "}") {
		inner := s[1 : len(s)-1]
		if inner == "" {
			return []string{}
		}
		parts := strings.Split(inner, ",")
		result := make([]string, 0, len(parts))
		for _, p := range parts {
			p = strings.TrimSpace(p)
			// Remove surrounding quotes if present
			if len(p) >= 2 && p[0] == '"' && p[len(p)-1] == '"' {
				p = p[1 : len(p)-1]
			}
			result = append(result, p)
		}
		return result
	}

	return []string{}
}
