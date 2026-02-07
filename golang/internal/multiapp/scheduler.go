package multiapp

import (
	"log"
	"time"

	"rocket-backend/internal/engine"
)

// MultiAppScheduler runs workflow timeouts and webhook retries across all apps.
type MultiAppScheduler struct {
	manager        *AppManager
	workflowTicker *time.Ticker
	webhookTicker  *time.Ticker
	done           chan struct{}
}

func NewMultiAppScheduler(manager *AppManager) *MultiAppScheduler {
	return &MultiAppScheduler{manager: manager}
}

// Start begins background tickers for all apps.
func (s *MultiAppScheduler) Start() {
	s.done = make(chan struct{})
	s.workflowTicker = time.NewTicker(60 * time.Second)
	s.webhookTicker = time.NewTicker(30 * time.Second)
	go s.run()
	log.Println("Multi-app scheduler started (workflows: 60s, webhooks: 30s)")
}

// Stop halts all background tickers.
func (s *MultiAppScheduler) Stop() {
	if s.workflowTicker != nil {
		s.workflowTicker.Stop()
	}
	if s.webhookTicker != nil {
		s.webhookTicker.Stop()
	}
	if s.done != nil {
		close(s.done)
	}
}

func (s *MultiAppScheduler) run() {
	for {
		select {
		case <-s.done:
			return
		case <-s.workflowTicker.C:
			s.processAllWorkflowTimeouts()
		case <-s.webhookTicker.C:
			s.processAllWebhookRetries()
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
