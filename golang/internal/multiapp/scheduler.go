package multiapp

import (
	"context"
	"log"
	"time"

	"rocket-backend/internal/config"
	"rocket-backend/internal/engine"
	"rocket-backend/internal/instrument"
)

// MultiAppScheduler runs workflow timeouts, webhook retries, and event cleanup across all apps.
type MultiAppScheduler struct {
	manager        *AppManager
	instrConfig    config.InstrumentationConfig
	workflowTicker *time.Ticker
	webhookTicker  *time.Ticker
	cleanupTicker  *time.Ticker
	done           chan struct{}
}

func NewMultiAppScheduler(manager *AppManager, instrCfg config.InstrumentationConfig) *MultiAppScheduler {
	return &MultiAppScheduler{manager: manager, instrConfig: instrCfg}
}

// Start begins background tickers for all apps.
func (s *MultiAppScheduler) Start() {
	s.done = make(chan struct{})
	s.workflowTicker = time.NewTicker(60 * time.Second)
	s.webhookTicker = time.NewTicker(30 * time.Second)
	if s.instrConfig.Enabled {
		s.cleanupTicker = time.NewTicker(1 * time.Hour)
	}
	go s.run()
	log.Println("Multi-app scheduler started (workflows: 60s, webhooks: 30s, event cleanup: 1h)")
}

// Stop halts all background tickers.
func (s *MultiAppScheduler) Stop() {
	if s.workflowTicker != nil {
		s.workflowTicker.Stop()
	}
	if s.webhookTicker != nil {
		s.webhookTicker.Stop()
	}
	if s.cleanupTicker != nil {
		s.cleanupTicker.Stop()
	}
	if s.done != nil {
		close(s.done)
	}
}

func (s *MultiAppScheduler) run() {
	// If cleanup ticker is nil (instrumentation disabled), use a stopped channel
	var cleanupCh <-chan time.Time
	if s.cleanupTicker != nil {
		cleanupCh = s.cleanupTicker.C
	}

	for {
		select {
		case <-s.done:
			return
		case <-s.workflowTicker.C:
			s.processAllWorkflowTimeouts()
		case <-s.webhookTicker.C:
			s.processAllWebhookRetries()
		case <-cleanupCh:
			s.processAllEventCleanup()
		}
	}
}

func (s *MultiAppScheduler) processAllWorkflowTimeouts() {
	for _, ac := range s.manager.AllContexts() {
		engine.ProcessWorkflowTimeouts(ac.Store, ac.Registry)
	}
}

func (s *MultiAppScheduler) processAllWebhookRetries() {
	for _, ac := range s.manager.AllContexts() {
		engine.ProcessWebhookRetries(ac.Store)
	}
}

func (s *MultiAppScheduler) processAllEventCleanup() {
	ctx := context.Background()
	for _, ac := range s.manager.AllContexts() {
		instrument.CleanupOldEvents(ctx, ac.Store.DB, ac.Store.Dialect, s.instrConfig.RetentionDays)
	}
}
