package ai

import (
	"encoding/json"

	"github.com/gofiber/fiber/v2"

	"rocket-backend/internal/engine"
	"rocket-backend/internal/metadata"
)

// Handler handles AI schema generation endpoints.
type Handler struct {
	provider *Provider
	registry *metadata.Registry
}

// NewHandler creates a new AI handler.
func NewHandler(provider *Provider, registry *metadata.Registry) *Handler {
	return &Handler{provider: provider, registry: registry}
}

// Status returns whether AI is configured and the model name.
func (h *Handler) Status(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{
		"data": fiber.Map{
			"configured": true,
			"model":      h.provider.Model(),
		},
	})
}

// Generate accepts a natural language prompt and returns a generated schema.
func (h *Handler) Generate(c *fiber.Ctx) error {
	var body struct {
		Prompt string `json:"prompt"`
	}
	if err := c.BodyParser(&body); err != nil {
		return engine.NewAppError("INVALID_PAYLOAD", 400, "Invalid request body")
	}

	if body.Prompt == "" {
		return engine.NewAppError("INVALID_PAYLOAD", 400, "prompt is required")
	}
	if len(body.Prompt) > 5000 {
		return engine.NewAppError("INVALID_PAYLOAD", 400, "prompt must be 5000 characters or fewer")
	}

	// Inject existing entity names so AI doesn't duplicate them
	var existingEntities []string
	for _, e := range h.registry.AllEntities() {
		existingEntities = append(existingEntities, e.Name)
	}

	systemPrompt := BuildSystemPrompt(existingEntities)
	raw, err := h.provider.Generate(systemPrompt, body.Prompt)
	if err != nil {
		return err
	}

	// Parse the JSON response
	var schema map[string]any
	if err := json.Unmarshal([]byte(raw), &schema); err != nil {
		return engine.NewAppError("AI_REQUEST_FAILED", 502,
			"AI returned invalid JSON. Try rephrasing your prompt.")
	}

	// Ensure version field exists
	if _, ok := schema["version"]; !ok {
		schema["version"] = 1
	}

	return c.JSON(fiber.Map{"data": fiber.Map{"schema": schema}})
}
