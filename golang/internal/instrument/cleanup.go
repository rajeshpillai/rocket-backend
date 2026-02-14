package instrument

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CleanupOldEvents deletes events older than retentionDays from the _events table.
func CleanupOldEvents(ctx context.Context, pool *pgxpool.Pool, retentionDays int) {
	sql := `DELETE FROM _events WHERE created_at < now() - ($1 || ' days')::interval`
	result, err := pool.Exec(ctx, sql, fmt.Sprintf("%d", retentionDays))
	if err != nil {
		log.Printf("ERROR: event cleanup: %v", err)
		return
	}
	if result.RowsAffected() > 0 {
		log.Printf("Event cleanup: deleted %d old events", result.RowsAffected())
	}
}
