package instrument

import (
	"context"
	"database/sql"
	"fmt"
	"log"

	"rocket-backend/internal/store"
)

// CleanupOldEvents deletes events older than retentionDays from the _events table.
func CleanupOldEvents(ctx context.Context, db *sql.DB, dialect store.Dialect, retentionDays int) {
	pb := dialect.NewParamBuilder()
	whereExpr := dialect.IntervalDeleteExpr("created_at", pb, fmt.Sprintf("%d", retentionDays))
	sqlStr := fmt.Sprintf("DELETE FROM _events WHERE %s", whereExpr)
	result, err := db.ExecContext(ctx, sqlStr, pb.Params()...)
	if err != nil {
		log.Printf("ERROR: event cleanup: %v", err)
		return
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		log.Printf("ERROR: event cleanup rows affected: %v", err)
		return
	}
	if rowsAffected > 0 {
		log.Printf("Event cleanup: deleted %d old events", rowsAffected)
	}
}
