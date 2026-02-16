package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"rocket-backend/internal/engine"
)

// Provider is an OpenAI-compatible chat completions client.
type Provider struct {
	baseURL string
	apiKey  string
	model   string
	client  *http.Client
}

// NewProvider creates a new AI provider. Returns nil if not configured.
func NewProvider(baseURL, apiKey, model string) *Provider {
	if baseURL == "" || apiKey == "" || model == "" {
		return nil
	}
	return &Provider{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		model:   model,
		client:  &http.Client{},
	}
}

// Model returns the configured model name.
func (p *Provider) Model() string {
	return p.model
}

type chatRequest struct {
	Model          string        `json:"model"`
	Temperature    float64       `json:"temperature"`
	ResponseFormat responseFmt   `json:"response_format"`
	Messages       []chatMessage `json:"messages"`
}

type responseFmt struct {
	Type string `json:"type"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

type apiError struct {
	Error struct {
		Message string `json:"message"`
	} `json:"error"`
}

// Generate sends a system + user prompt to the LLM and returns the raw response text.
func (p *Provider) Generate(systemPrompt, userPrompt string) (string, error) {
	url := p.baseURL + "/chat/completions"

	body := chatRequest{
		Model:          p.model,
		Temperature:    0.3,
		ResponseFormat: responseFmt{Type: "json_object"},
		Messages: []chatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return "", engine.NewAppError("AI_REQUEST_FAILED", 502, "Failed to marshal AI request")
	}

	req, err := http.NewRequest("POST", url, bytes.NewReader(payload))
	if err != nil {
		return "", engine.NewAppError("AI_REQUEST_FAILED", 502, "Failed to create AI request")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.apiKey)

	resp, err := p.client.Do(req)
	if err != nil {
		return "", engine.NewAppError("AI_REQUEST_FAILED", 502,
			fmt.Sprintf("Failed to connect to AI provider: %v", err))
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", engine.NewAppError("AI_REQUEST_FAILED", 502, "Failed to read AI response")
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var apiErr apiError
		detail := string(respBody)
		if json.Unmarshal(respBody, &apiErr) == nil && apiErr.Error.Message != "" {
			detail = apiErr.Error.Message
		}
		return "", engine.NewAppError("AI_REQUEST_FAILED", 502,
			fmt.Sprintf("AI provider returned %d: %s", resp.StatusCode, detail))
	}

	var chatResp chatResponse
	if err := json.Unmarshal(respBody, &chatResp); err != nil {
		return "", engine.NewAppError("AI_REQUEST_FAILED", 502, "Failed to parse AI response")
	}

	if len(chatResp.Choices) == 0 || chatResp.Choices[0].Message.Content == "" {
		return "", engine.NewAppError("AI_REQUEST_FAILED", 502, "AI provider returned empty response")
	}

	return chatResp.Choices[0].Message.Content, nil
}
