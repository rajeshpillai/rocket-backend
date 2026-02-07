package engine

import (
	"context"
	"log"
	"time"

	"rocket-backend/internal/metadata"
	"rocket-backend/internal/store"
)

// WorkflowScheduler runs background tasks for workflow timeouts.
type WorkflowScheduler struct {
	store    *store.Store
	registry *metadata.Registry
	ticker   *time.Ticker
	done     chan struct{}
}

func NewWorkflowScheduler(s *store.Store, reg *metadata.Registry) *WorkflowScheduler {
	return &WorkflowScheduler{store: s, registry: reg}
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
			ws.processTimeouts()
		}
	}
}

// ProcessWorkflowTimeouts processes timed-out workflow instances for a given store and registry.
func ProcessWorkflowTimeouts(s *store.Store, reg *metadata.Registry) {
	tmp := &WorkflowScheduler{store: s, registry: reg}
	tmp.processTimeouts()
}

func (ws *WorkflowScheduler) processTimeouts() {
	ctx := context.Background()

	rows, err := store.QueryRows(ctx, ws.store.Pool,
		`SELECT id, workflow_id, workflow_name, status, current_step, current_step_deadline, context, history, created_at, updated_at
		 FROM _workflow_instances
		 WHERE status = 'running'
		   AND current_step_deadline IS NOT NULL
		   AND current_step_deadline < NOW()`)
	if err != nil {
		log.Printf("ERROR: workflow scheduler query failed: %v", err)
		return
	}

	for _, row := range rows {
		instance, err := parseWorkflowInstanceRow(row)
		if err != nil {
			log.Printf("WARN: skipping timed-out instance: %v", err)
			continue
		}

		wf := ws.registry.GetWorkflow(instance.WorkflowName)
		if wf == nil {
			log.Printf("WARN: workflow definition not found for timed-out instance %s: %s", instance.ID, instance.WorkflowName)
			continue
		}

		step := wf.FindStep(instance.CurrentStep)
		if step == nil || step.OnTimeout == nil {
			// No timeout handler; mark as failed
			log.Printf("WARN: no on_timeout handler for step %s in workflow %s, marking instance %s as failed",
				instance.CurrentStep, wf.Name, instance.ID)
			instance.Status = "failed"
			instance.History = append(instance.History, metadata.WorkflowHistoryEntry{
				Step:   instance.CurrentStep,
				Status: "timed_out",
				At:     time.Now().UTC().Format(time.RFC3339),
			})
			persistInstance(ctx, ws.store, instance)
			continue
		}

		// Execute on_timeout path
		instance.History = append(instance.History, metadata.WorkflowHistoryEntry{
			Step:   instance.CurrentStep,
			Status: "timed_out",
			At:     time.Now().UTC().Format(time.RFC3339),
		})
		instance.CurrentStepDeadline = nil
		instance.CurrentStep = step.OnTimeout.Goto

		if instance.CurrentStep == "end" {
			instance.Status = "completed"
			instance.CurrentStep = ""
			persistInstance(ctx, ws.store, instance)
		} else {
			if err := advanceWorkflow(ctx, ws.store, ws.registry, instance, wf); err != nil {
				log.Printf("ERROR: failed to advance timed-out workflow %s: %v", instance.ID, err)
			}
		}

		log.Printf("Processed timeout for workflow instance %s (step: %s)", instance.ID, step.ID)
	}
}
