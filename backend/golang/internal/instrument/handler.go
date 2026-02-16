package instrument

import (
	"database/sql"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"

	"rocket-backend/internal/store"
)

// EventHandler exposes REST endpoints for querying and emitting events.
type EventHandler struct {
	db      *sql.DB
	dialect store.Dialect
}

// NewEventHandler creates an EventHandler backed by the given db and dialect.
func NewEventHandler(db *sql.DB, dialect store.Dialect) *EventHandler {
	return &EventHandler{db: db, dialect: dialect}
}

// Emit handles POST /_events — emit a custom business event (any authenticated user).
func (h *EventHandler) Emit(c *fiber.Ctx) error {
	var body struct {
		Action   string         `json:"action"`
		Entity   string         `json:"entity"`
		RecordID string         `json:"record_id"`
		Metadata map[string]any `json:"metadata"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": fiber.Map{"code": "INVALID_PAYLOAD", "message": "Invalid JSON body"}})
	}

	if body.Action == "" {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": "action is required"}})
	}

	inst := GetInstrumenter(c.UserContext())
	inst.EmitBusinessEvent(c.UserContext(), body.Action, body.Entity, body.RecordID, body.Metadata)

	return c.JSON(fiber.Map{"data": fiber.Map{"status": "ok"}})
}

// List handles GET /_events — list events with filters (admin only).
func (h *EventHandler) List(c *fiber.Ctx) error {
	ctx := c.UserContext()

	var conditions []string
	var args []any
	argIdx := 1

	if v := c.Query("source"); v != "" {
		conditions = append(conditions, fmt.Sprintf("source = %s", h.dialect.Placeholder(argIdx)))
		args = append(args, v)
		argIdx++
	}
	if v := c.Query("component"); v != "" {
		conditions = append(conditions, fmt.Sprintf("component = %s", h.dialect.Placeholder(argIdx)))
		args = append(args, v)
		argIdx++
	}
	if v := c.Query("action"); v != "" {
		conditions = append(conditions, fmt.Sprintf("action = %s", h.dialect.Placeholder(argIdx)))
		args = append(args, v)
		argIdx++
	}
	if v := c.Query("entity"); v != "" {
		conditions = append(conditions, fmt.Sprintf("entity = %s", h.dialect.Placeholder(argIdx)))
		args = append(args, v)
		argIdx++
	}
	if v := c.Query("event_type"); v != "" {
		conditions = append(conditions, fmt.Sprintf("event_type = %s", h.dialect.Placeholder(argIdx)))
		args = append(args, v)
		argIdx++
	}
	if v := c.Query("trace_id"); v != "" {
		conditions = append(conditions, fmt.Sprintf("trace_id = %s", h.dialect.Placeholder(argIdx)))
		args = append(args, v)
		argIdx++
	}
	if v := c.Query("user_id"); v != "" {
		conditions = append(conditions, fmt.Sprintf("user_id = %s", h.dialect.Placeholder(argIdx)))
		args = append(args, v)
		argIdx++
	}
	if v := c.Query("status"); v != "" {
		conditions = append(conditions, fmt.Sprintf("status = %s", h.dialect.Placeholder(argIdx)))
		args = append(args, v)
		argIdx++
	}
	if v := c.Query("from"); v != "" {
		conditions = append(conditions, fmt.Sprintf("created_at >= %s", h.dialect.Placeholder(argIdx)))
		args = append(args, v)
		argIdx++
	}
	if v := c.Query("to"); v != "" {
		conditions = append(conditions, fmt.Sprintf("created_at <= %s", h.dialect.Placeholder(argIdx)))
		args = append(args, v)
		argIdx++
	}

	// Pagination
	page, _ := strconv.Atoi(c.Query("page", "1"))
	if page < 1 {
		page = 1
	}
	perPage, _ := strconv.Atoi(c.Query("per_page", "50"))
	if perPage < 1 {
		perPage = 50
	}
	if perPage > 100 {
		perPage = 100
	}
	offset := (page - 1) * perPage

	// Sort
	sortParam := c.Query("sort", "-created_at")
	orderBy := "created_at DESC"
	if sortParam == "created_at" {
		orderBy = "created_at ASC"
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = " WHERE " + strings.Join(conditions, " AND ")
	}

	// Count query
	countSQL := "SELECT COUNT(*) as count FROM _events" + whereClause
	countRow, err := store.QueryRow(ctx, h.db, countSQL, args...)
	if err != nil {
		return fmt.Errorf("count events: %w", err)
	}
	total := toInt(countRow["count"])

	// Data query
	dataSQL := fmt.Sprintf(
		"SELECT id, trace_id, span_id, parent_span_id, event_type, source, component, action, entity, record_id, user_id, duration_ms, status, metadata, created_at FROM _events%s ORDER BY %s LIMIT %s OFFSET %s",
		whereClause, orderBy, h.dialect.Placeholder(argIdx), h.dialect.Placeholder(argIdx+1),
	)
	dataArgs := append(args, perPage, offset)
	rows, err := store.QueryRows(ctx, h.db, dataSQL, dataArgs...)
	if err != nil {
		return fmt.Errorf("list events: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}

	return c.JSON(fiber.Map{
		"data": rows,
		"pagination": fiber.Map{
			"page":     page,
			"per_page": perPage,
			"total":    total,
		},
	})
}

// GetTrace handles GET /_events/trace/:traceId — full trace waterfall (admin only).
func (h *EventHandler) GetTrace(c *fiber.Ctx) error {
	ctx := c.UserContext()
	traceID := c.Params("traceId")
	if traceID == "" {
		return c.Status(422).JSON(fiber.Map{"error": fiber.Map{"code": "VALIDATION_FAILED", "message": "trace_id is required"}})
	}

	rows, err := store.QueryRows(ctx, h.db,
		fmt.Sprintf("SELECT id, trace_id, span_id, parent_span_id, event_type, source, component, action, entity, record_id, user_id, duration_ms, status, metadata, created_at FROM _events WHERE trace_id = %s ORDER BY created_at ASC", h.dialect.Placeholder(1)),
		traceID,
	)
	if err != nil {
		return fmt.Errorf("get trace: %w", err)
	}
	if len(rows) == 0 {
		return c.Status(404).JSON(fiber.Map{"error": fiber.Map{"code": "NOT_FOUND", "message": "Trace not found: " + traceID}})
	}

	// Build tree structure from spans
	type spanNode struct {
		data     map[string]any
		children []map[string]any
	}

	spanMap := make(map[string]*spanNode, len(rows))
	for _, row := range rows {
		spanID, _ := row["span_id"].(string)
		spanMap[spanID] = &spanNode{
			data:     row,
			children: []map[string]any{},
		}
	}

	var rootSpan map[string]any
	for _, node := range spanMap {
		parentID, _ := node.data["parent_span_id"].(string)
		if parentID != "" {
			if parent, ok := spanMap[parentID]; ok {
				parent.children = append(parent.children, node.data)
			}
		}
		if parentID == "" {
			rootSpan = node.data
		}
	}

	// Add children to each span's output
	for _, node := range spanMap {
		node.data["children"] = node.children
	}

	// If no explicit root, use first span
	if rootSpan == nil && len(rows) > 0 {
		spanID, _ := rows[0]["span_id"].(string)
		if node, ok := spanMap[spanID]; ok {
			rootSpan = node.data
		}
	}

	// Total duration from root
	var totalDurationMs any
	if rootSpan != nil {
		totalDurationMs = rootSpan["duration_ms"]
	}

	return c.JSON(fiber.Map{
		"data": fiber.Map{
			"trace_id":          traceID,
			"root_span":         rootSpan,
			"spans":             rows,
			"total_duration_ms": totalDurationMs,
		},
	})
}

// GetStats handles GET /_events/stats — aggregate stats (admin only).
func (h *EventHandler) GetStats(c *fiber.Ctx) error {
	ctx := c.UserContext()

	// Conditions for by-source query (requires duration_ms IS NOT NULL)
	conditions := []string{"duration_ms IS NOT NULL"}
	var args []any
	argIdx := 1

	if v := c.Query("from"); v != "" {
		conditions = append(conditions, fmt.Sprintf("created_at >= %s", h.dialect.Placeholder(argIdx)))
		args = append(args, v)
		argIdx++
	}
	if v := c.Query("to"); v != "" {
		conditions = append(conditions, fmt.Sprintf("created_at <= %s", h.dialect.Placeholder(argIdx)))
		args = append(args, v)
		argIdx++
	}
	if v := c.Query("entity"); v != "" {
		conditions = append(conditions, fmt.Sprintf("entity = %s", h.dialect.Placeholder(argIdx)))
		args = append(args, v)
		argIdx++
	}

	whereClause := " WHERE " + strings.Join(conditions, " AND ")

	// Build percentile and filter-count expressions
	var p95Expr string
	if h.dialect.SupportsPercentile() {
		p95Expr = h.dialect.PercentileExpr(0.95, "duration_ms")
	} else {
		p95Expr = "NULL"
	}
	filterCountExpr := h.dialect.FilterCountExpr("status = 'error'")

	// By-source stats
	bySourceSQL := fmt.Sprintf(
		`SELECT source, COUNT(*) as count, AVG(duration_ms) as avg_duration_ms, %s as p95_duration_ms, %s as error_count FROM _events%s GROUP BY source ORDER BY count DESC`,
		p95Expr, filterCountExpr, whereClause,
	)
	bySourceRows, err := store.QueryRows(ctx, h.db, bySourceSQL, args...)
	if err != nil {
		return fmt.Errorf("stats by source: %w", err)
	}

	// Overall stats (all events, not just those with duration_ms)
	overallConditions := []string{}
	var overallArgs []any
	overallIdx := 1

	if v := c.Query("from"); v != "" {
		overallConditions = append(overallConditions, fmt.Sprintf("created_at >= %s", h.dialect.Placeholder(overallIdx)))
		overallArgs = append(overallArgs, v)
		overallIdx++
	}
	if v := c.Query("to"); v != "" {
		overallConditions = append(overallConditions, fmt.Sprintf("created_at <= %s", h.dialect.Placeholder(overallIdx)))
		overallArgs = append(overallArgs, v)
		overallIdx++
	}
	if v := c.Query("entity"); v != "" {
		overallConditions = append(overallConditions, fmt.Sprintf("entity = %s", h.dialect.Placeholder(overallIdx)))
		overallArgs = append(overallArgs, v)
		overallIdx++
	}

	overallWhere := ""
	if len(overallConditions) > 0 {
		overallWhere = " WHERE " + strings.Join(overallConditions, " AND ")
	}

	totalSQL := fmt.Sprintf(
		`SELECT COUNT(*) as total_events, AVG(duration_ms) as avg_latency_ms, %s as p95_latency_ms, %s as error_count FROM _events%s`,
		p95Expr, filterCountExpr, overallWhere,
	)

	totalEvents := 0
	var avgLatencyMs any
	var p95LatencyMs any
	var errorRate float64

	totalRow, err := store.QueryRow(ctx, h.db, totalSQL, overallArgs...)
	if err == nil {
		totalEvents = toInt(totalRow["total_events"])
		avgLatencyMs = totalRow["avg_latency_ms"]
		p95LatencyMs = totalRow["p95_latency_ms"]
		errorCount := toInt(totalRow["error_count"])
		if totalEvents > 0 {
			errorRate = float64(errorCount) / float64(totalEvents)
			// Round to 4 decimal places
			errorRate = math.Round(errorRate*10000) / 10000
		}
	}

	// If dialect does not support percentile_cont, compute p95 in Go
	if !h.dialect.SupportsPercentile() && totalEvents > 0 {
		p95SQL := fmt.Sprintf("SELECT duration_ms FROM _events%s AND duration_ms IS NOT NULL ORDER BY duration_ms", overallWhere)
		if overallWhere == "" {
			p95SQL = "SELECT duration_ms FROM _events WHERE duration_ms IS NOT NULL ORDER BY duration_ms"
		}
		p95Rows, p95Err := store.QueryRows(ctx, h.db, p95SQL, overallArgs...)
		if p95Err == nil && len(p95Rows) > 0 {
			idx := int(float64(len(p95Rows)) * 0.95)
			if idx >= len(p95Rows) {
				idx = len(p95Rows) - 1
			}
			p95LatencyMs = p95Rows[idx]["duration_ms"]
		}
	}

	bySource := make([]fiber.Map, 0, len(bySourceRows))
	for _, row := range bySourceRows {
		p95Val := row["p95_duration_ms"]
		// For SQLite, compute per-source p95 in Go if needed
		if !h.dialect.SupportsPercentile() {
			p95Val = nil // Set to null for by-source on non-percentile dialects
		}
		bySource = append(bySource, fiber.Map{
			"source":          row["source"],
			"count":           toInt(row["count"]),
			"avg_duration_ms": row["avg_duration_ms"],
			"p95_duration_ms": p95Val,
			"error_count":     toInt(row["error_count"]),
		})
	}

	// If dialect does not support percentile, compute per-source p95 in Go
	if !h.dialect.SupportsPercentile() && len(bySource) > 0 {
		for i, bs := range bySource {
			source, _ := bs["source"].(string)
			if source == "" {
				continue
			}
			srcArgs := make([]any, len(args))
			copy(srcArgs, args)
			srcArgs = append(srcArgs, source)
			srcP95SQL := fmt.Sprintf(
				"SELECT duration_ms FROM _events%s AND source = %s ORDER BY duration_ms",
				whereClause, h.dialect.Placeholder(argIdx),
			)
			srcP95Rows, srcErr := store.QueryRows(ctx, h.db, srcP95SQL, srcArgs...)
			if srcErr == nil && len(srcP95Rows) > 0 {
				durations := make([]float64, 0, len(srcP95Rows))
				for _, r := range srcP95Rows {
					if d := toFloat(r["duration_ms"]); d > 0 {
						durations = append(durations, d)
					}
				}
				if len(durations) > 0 {
					sort.Float64s(durations)
					idx := int(float64(len(durations)) * 0.95)
					if idx >= len(durations) {
						idx = len(durations) - 1
					}
					bySource[i]["p95_duration_ms"] = durations[idx]
				}
			}
		}
	}

	return c.JSON(fiber.Map{
		"data": fiber.Map{
			"total_events":   totalEvents,
			"avg_latency_ms": avgLatencyMs,
			"p95_latency_ms": p95LatencyMs,
			"error_rate":     errorRate,
			"by_source":      bySource,
		},
	})
}

// toInt safely converts various numeric types to int.
func toInt(v any) int {
	switch val := v.(type) {
	case int:
		return val
	case int32:
		return int(val)
	case int64:
		return int(val)
	case float64:
		return int(val)
	case string:
		n, _ := strconv.Atoi(val)
		return n
	default:
		return 0
	}
}

// toFloat safely converts various numeric types to float64.
func toFloat(v any) float64 {
	switch val := v.(type) {
	case float64:
		return val
	case float32:
		return float64(val)
	case int:
		return float64(val)
	case int32:
		return float64(val)
	case int64:
		return float64(val)
	case string:
		f, _ := strconv.ParseFloat(val, 64)
		return f
	default:
		return 0
	}
}
