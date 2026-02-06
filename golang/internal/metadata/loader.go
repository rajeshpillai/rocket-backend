package metadata

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
)

// LoadAll reads all entities and relations from the database and populates the registry.
func LoadAll(ctx context.Context, pool *pgxpool.Pool, reg *Registry) error {
	entities, err := loadEntities(ctx, pool)
	if err != nil {
		return fmt.Errorf("load entities: %w", err)
	}

	relations, err := loadRelations(ctx, pool)
	if err != nil {
		return fmt.Errorf("load relations: %w", err)
	}

	reg.Load(entities, relations)
	log.Printf("Loaded %d entities, %d relations into registry", len(entities), len(relations))
	return nil
}

// Reload is an alias for LoadAll, called after admin mutations.
func Reload(ctx context.Context, pool *pgxpool.Pool, reg *Registry) error {
	return LoadAll(ctx, pool, reg)
}

func loadEntities(ctx context.Context, pool *pgxpool.Pool) ([]*Entity, error) {
	rows, err := pool.Query(ctx, "SELECT name, definition FROM _entities ORDER BY name")
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

func loadRelations(ctx context.Context, pool *pgxpool.Pool) ([]*Relation, error) {
	rows, err := pool.Query(ctx, "SELECT name, definition FROM _relations ORDER BY name")
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
