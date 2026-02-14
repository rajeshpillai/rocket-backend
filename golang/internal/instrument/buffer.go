package instrument

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"rocket-backend/internal/store"
)

// EventBuffer collects events in memory and periodically flushes them
// to the _events table in a batch insert.
type EventBuffer struct {
	mu      sync.Mutex
	events  []Event
	db      *sql.DB
	dialect store.Dialect
	maxSize int
	ticker  *time.Ticker
	done    chan struct{}
}

// NewEventBuffer creates a buffer that flushes on a timer or when full.
func NewEventBuffer(db *sql.DB, dialect store.Dialect, maxSize int, flushIntervalMs int) *EventBuffer {
	eb := &EventBuffer{
		db:      db,
		dialect: dialect,
		maxSize: maxSize,
		done:    make(chan struct{}),
	}
	eb.ticker = time.NewTicker(time.Duration(flushIntervalMs) * time.Millisecond)
	go eb.run()
	return eb
}

func (eb *EventBuffer) run() {
	for {
		select {
		case <-eb.done:
			return
		case <-eb.ticker.C:
			eb.Flush()
		}
	}
}

// Enqueue adds an event to the buffer. If the buffer is full, a flush
// is triggered asynchronously.
func (eb *EventBuffer) Enqueue(event Event) {
	eb.mu.Lock()
	eb.events = append(eb.events, event)
	shouldFlush := len(eb.events) >= eb.maxSize
	eb.mu.Unlock()
	if shouldFlush {
		go eb.Flush()
	}
}

// Flush writes all buffered events to the database in a single batch insert.
func (eb *EventBuffer) Flush() {
	eb.mu.Lock()
	if len(eb.events) == 0 {
		eb.mu.Unlock()
		return
	}
	batch := eb.events
	eb.events = nil
	eb.mu.Unlock()

	ctx := context.Background()
	tx, err := eb.db.BeginTx(ctx, nil)
	if err != nil {
		log.Printf("ERROR: event buffer begin tx: %v", err)
		return
	}

	if syncOff := eb.dialect.SyncCommitOff(); syncOff != "" {
		_, err = tx.ExecContext(ctx, syncOff)
		if err != nil {
			tx.Rollback()
			log.Printf("ERROR: event buffer set sync commit: %v", err)
			return
		}
	}

	// Build batch insert
	cols := []string{"trace_id", "span_id", "parent_span_id", "event_type", "source", "component", "action", "entity", "record_id", "user_id", "duration_ms", "status", "metadata"}
	var placeholders []string
	var args []any
	for i, e := range batch {
		offset := i * len(cols)
		ph := make([]string, len(cols))
		for j := range cols {
			ph[j] = eb.dialect.Placeholder(offset + j + 1)
		}
		placeholders = append(placeholders, "("+strings.Join(ph, ",")+")")

		var metaJSON any
		if e.Metadata != nil {
			b, _ := json.Marshal(e.Metadata)
			metaJSON = string(b)
		}

		args = append(args, e.TraceID, e.SpanID, e.ParentSpanID, e.EventType, e.Source, e.Component, e.Action, e.Entity, e.RecordID, e.UserID, e.DurationMs, e.Status, metaJSON)
	}

	sqlStr := fmt.Sprintf("INSERT INTO _events (%s) VALUES %s", strings.Join(cols, ","), strings.Join(placeholders, ","))
	_, err = tx.ExecContext(ctx, sqlStr, args...)
	if err != nil {
		tx.Rollback()
		log.Printf("ERROR: event buffer insert: %v", err)
		return
	}

	if err := tx.Commit(); err != nil {
		log.Printf("ERROR: event buffer commit: %v", err)
	}
}

// Stop halts the background ticker and flushes remaining events.
func (eb *EventBuffer) Stop() {
	if eb.ticker != nil {
		eb.ticker.Stop()
	}
	close(eb.done)
	eb.Flush()
}
