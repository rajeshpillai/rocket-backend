package engine

import (
	"context"
	"log"
	"time"

	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

// WorkflowScheduler runs background tasks for workflow timeouts.
// Delegates all logic to WFEngine — no direct SQL or instance parsing.
type WorkflowScheduler struct {
	store    *store.Store
	registry *metadata.Registry
	engine   *WFEngine
	ticker   *time.Ticker
	done     chan struct{}
}

func NewWorkflowScheduler(s *store.Store, reg *metadata.Registry) *WorkflowScheduler {
	return &WorkflowScheduler{
		store:    s,
		registry: reg,
		engine:   NewDefaultWFEngine(s, reg),
	}
}

// Start begins the background ticker for processing timeouts.
func (ws *WorkflowScheduler) Start() {
	ws.ticker = time.NewTicker(60 * time.Second)
	ws.done = make(chan struct{})
	go ws.run()
	log.Println("Workflow scheduler started (60s interval)")
}

// Stop halts the background ticker.
func (ws *WorkflowScheduler) Stop() {
	if ws.ticker != nil {
		ws.ticker.Stop()
	}
	if ws.done != nil {
		close(ws.done)
	}
}

func (ws *WorkflowScheduler) run() {
	for {
		select {
		case <-ws.done:
			return
		case <-ws.ticker.C:
			ws.engine.ProcessTimeouts(context.Background())
		}
	}
}

// ProcessWorkflowTimeouts processes timed-out workflow instances for a given store and registry.
// Used by the multi-app scheduler.
func ProcessWorkflowTimeouts(s *store.Store, reg *metadata.Registry) {
	engine := NewDefaultWFEngine(s, reg)
	engine.ProcessTimeouts(context.Background())
}

// Ensure WorkflowHandler still has a function it needs — loadWorkflowInstance backward compat.
func loadWorkflowInstance(ctx context.Context, s *store.Store, id string) (*metadata.WorkflowInstance, error) {
	wfStore := &PgWorkflowStore{}
	return wfStore.LoadInstance(ctx, s.DB, s.Dialect, id)
}
