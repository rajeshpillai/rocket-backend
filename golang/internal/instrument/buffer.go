package instrument

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// EventBuffer collects events in memory and periodically flushes them
// to the _events table in a batch insert.
type EventBuffer struct {
	mu      sync.Mutex
	events  []Event
	pool    *pgxpool.Pool
	maxSize int
	ticker  *time.Ticker
	done    chan struct{}
}

// NewEventBuffer creates a buffer that flushes on a timer or when full.
func NewEventBuffer(pool *pgxpool.Pool, maxSize int, flushIntervalMs int) *EventBuffer {
	eb := &EventBuffer{
		pool:    pool,
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
	conn, err := eb.pool.Acquire(ctx)
	if err != nil {
		log.Printf("ERROR: event buffer acquire conn: %v", err)
		return
	}
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		log.Printf("ERROR: event buffer begin tx: %v", err)
		return
	}

	_, err = tx.Exec(ctx, "SET LOCAL synchronous_commit = off")
	if err != nil {
		tx.Rollback(ctx)
		log.Printf("ERROR: event buffer set sync commit: %v", err)
		return
	}

	// Build batch insert
	cols := []string{"trace_id", "span_id", "parent_span_id", "event_type", "source", "component", "action", "entity", "record_id", "user_id", "duration_ms", "status", "metadata"}
	var placeholders []string
	var args []any
	for i, e := range batch {
		offset := i * len(cols)
		ph := make([]string, len(cols))
		for j := range cols {
			ph[j] = fmt.Sprintf("$%d", offset+j+1)
		}
		placeholders = append(placeholders, "("+strings.Join(ph, ",")+")")

		var metaJSON any
		if e.Metadata != nil {
			b, _ := json.Marshal(e.Metadata)
			metaJSON = string(b)
		}

		args = append(args, e.TraceID, e.SpanID, e.ParentSpanID, e.EventType, e.Source, e.Component, e.Action, e.Entity, e.RecordID, e.UserID, e.DurationMs, e.Status, metaJSON)
	}

	sql := fmt.Sprintf("INSERT INTO _events (%s) VALUES %s", strings.Join(cols, ","), strings.Join(placeholders, ","))
	_, err = tx.Exec(ctx, sql, args...)
	if err != nil {
		tx.Rollback(ctx)
		log.Printf("ERROR: event buffer insert: %v", err)
		return
	}

	if err := tx.Commit(ctx); err != nil {
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
