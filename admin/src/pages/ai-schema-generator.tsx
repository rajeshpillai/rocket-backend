import { createSignal, onMount, Show, For } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { getAIStatus, generateSchema } from "../api/ai";
import { createApp, getAIStatusPlatform } from "../api/platform";
import { importSchema } from "../api/schema";
import type { ImportResult } from "../api/schema";
import { selectedApp, setSelectedApp } from "../stores/app";
import { addToast } from "../stores/notifications";
import { isApiError } from "../types/api";

const EXAMPLE_PROMPTS = [
  {
    label: "E-commerce",
    prompt:
      "E-commerce platform with products, categories, customers, orders, order items, and product reviews. Products have a status workflow (draft, active, archived). Orders have status tracking (pending, confirmed, shipped, delivered, cancelled).",
  },
  {
    label: "Blog / CMS",
    prompt:
      "Content management system with authors, categories, tags, posts, and comments. Posts have a editorial workflow (draft, review, published, archived). Tags have many-to-many relationship with posts.",
  },
  {
    label: "Project Management",
    prompt:
      "Project management tool with projects, sprints, tasks, team members, and comments. Tasks have status tracking (backlog, todo, in_progress, review, done). Tasks belong to sprints and are assigned to team members.",
  },
  {
    label: "Helpdesk",
    prompt:
      "Helpdesk ticketing system with customers, agents, tickets, ticket comments, and knowledge base articles. Tickets have priority (low, medium, high, urgent) and status workflow (open, assigned, in_progress, resolved, closed).",
  },
];

type Phase = "prompt" | "preview" | "applied";

const TABS = [
  "entities",
  "relations",
  "rules",
  "state_machines",
  "permissions",
  "ui_configs",
  "sample_data",
  "raw",
] as const;

type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  entities: "Entities",
  relations: "Relations",
  rules: "Rules",
  state_machines: "State Machines",
  permissions: "Permissions",
  ui_configs: "UI Configs",
  sample_data: "Sample Data",
  raw: "Raw JSON",
};

export function AISchemaGenerator() {
  const navigate = useNavigate();

  const [aiConfigured, setAIConfigured] = createSignal(true);
  const [aiModel, setAIModel] = createSignal("");
  const [phase, setPhase] = createSignal<Phase>("prompt");
  const [prompt, setPrompt] = createSignal("");
  const [generating, setGenerating] = createSignal(false);
  const [schema, setSchema] = createSignal<Record<string, any> | null>(null);
  const [rawJson, setRawJson] = createSignal("");
  const [activeTab, setActiveTab] = createSignal<Tab>("entities");
  const [applying, setApplying] = createSignal(false);
  const [importResult, setImportResult] = createSignal<ImportResult | null>(
    null,
  );
  const [error, setError] = createSignal<string | null>(null);

  // New app fields (when no app is selected)
  const [appName, setAppName] = createSignal("");
  const [appDisplayName, setAppDisplayName] = createSignal("");
  const [dbDriver, setDbDriver] = createSignal("postgres");
  const [createdAppName, setCreatedAppName] = createSignal<string | null>(null);

  const isNewAppMode = () => !selectedApp();

  onMount(async () => {
    try {
      if (selectedApp()) {
        const status = await getAIStatus();
        setAIConfigured(status.configured);
        setAIModel(status.model);
      } else {
        // No app selected — check AI status at platform level
        const resp = await getAIStatusPlatform();
        setAIConfigured(resp.data.configured);
        setAIModel(resp.data.model);
      }
    } catch {
      setAIConfigured(false);
    }
  });

  const handleGenerate = async () => {
    if (!prompt().trim()) return;
    setGenerating(true);
    setError(null);
    try {
      // If no app selected, create one first
      if (isNewAppMode()) {
        if (!appName().trim()) {
          setError("App name is required");
          setGenerating(false);
          return;
        }
        await createApp({
          name: appName().trim(),
          display_name: appDisplayName().trim() || appName().trim(),
          db_driver: dbDriver(),
        });
        setSelectedApp(appName().trim());
        setCreatedAppName(appName().trim());
        addToast("success", `App "${appName().trim()}" created`);
      }

      const result = await generateSchema(prompt());
      setSchema(result);
      setRawJson(JSON.stringify(result, null, 2));
      setActiveTab("entities");
      setPhase("preview");
    } catch (err) {
      if (isApiError(err)) {
        setError(err.error.message);
      } else {
        setError("Failed to generate schema. Please try again.");
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setError(null);
    try {
      // Use the raw JSON (user may have edited it)
      const data = JSON.parse(rawJson());
      const result = await importSchema(data);
      setImportResult(result);
      setPhase("applied");
      addToast("success", "Schema applied successfully");
    } catch (err) {
      if (isApiError(err)) {
        setError(err.error.message);
      } else if (err instanceof SyntaxError) {
        setError("Invalid JSON. Please fix the Raw JSON tab before applying.");
      } else {
        setError("Failed to apply schema.");
      }
    } finally {
      setApplying(false);
    }
  };

  const handleRegenerate = () => {
    setSchema(null);
    setRawJson("");
    setError(null);
    setPhase("prompt");
  };

  const handleNewGeneration = () => {
    setSchema(null);
    setRawJson("");
    setPrompt("");
    setError(null);
    setImportResult(null);
    setCreatedAppName(null);
    setPhase("prompt");
  };

  const sectionCount = (key: string): number => {
    const s = schema();
    if (!s) return 0;
    const val = s[key];
    if (Array.isArray(val)) return val.length;
    if (typeof val === "object" && val !== null) return Object.keys(val).length;
    return 0;
  };

  const sectionData = (key: string): string => {
    const s = schema();
    if (!s || !s[key]) return "[]";
    return JSON.stringify(s[key], null, 2);
  };

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">AI Schema Generator</h1>
          <p class="page-subtitle">
            {isNewAppMode()
              ? "Describe your application to create a new app with AI-generated schema"
              : `Generate schema for ${selectedApp()}`}
            {aiModel() ? ` using ${aiModel()}` : ""}
          </p>
        </div>
      </div>

      <Show when={!aiConfigured()}>
        <div
          class="p-4 mb-4 rounded-lg border"
          style="background: var(--color-warning-bg, #fef3cd); border-color: var(--color-warning-border, #ffc107);"
        >
          <p class="text-sm font-medium mb-1">AI Provider Not Configured</p>
          <p class="text-sm" style="opacity: 0.8">
            Set these environment variables in{" "}
            <code class="text-xs">expressjs/.env</code>:
          </p>
          <pre class="text-xs mt-2 p-2 rounded" style="background: rgba(0,0,0,0.05);">
{`ROCKET_AI_BASE_URL=https://api.openai.com/v1
ROCKET_AI_API_KEY=sk-your-key-here
ROCKET_AI_MODEL=gpt-4o`}
          </pre>
          <p class="text-xs mt-2" style="opacity: 0.7">
            Works with any OpenAI-compatible API (OpenAI, Groq, Together,
            Ollama, etc.)
          </p>
        </div>
      </Show>

      <Show when={error()}>
        <div class="form-error-text mb-4 p-3 rounded-lg" style="background: var(--color-error-bg, #f8d7da);">
          {error()}
        </div>
      </Show>

      {/* Phase 1: Prompt */}
      <Show when={phase() === "prompt"}>
        <div class="flex flex-col gap-4">
          {/* App details when creating a new app */}
          <Show when={isNewAppMode()}>
            <div class="card" style={{ "margin-bottom": "0.5rem" }}>
              <h3 style={{ "font-size": "0.95rem", "font-weight": "600", "margin-bottom": "0.75rem" }}>
                New App Details
              </h3>
              <div style={{ display: "flex", gap: "1rem", "flex-wrap": "wrap" }}>
                <div style={{ flex: "1", "min-width": "200px" }}>
                  <label class="form-label" for="ai-app-name">App Name (URL-safe slug)</label>
                  <input
                    id="ai-app-name"
                    class="form-input"
                    value={appName()}
                    onInput={(e) => setAppName(e.currentTarget.value)}
                    placeholder="e.g. ecommerce"
                    pattern="^[a-z][a-z0-9_-]*$"
                    disabled={generating()}
                  />
                </div>
                <div style={{ flex: "1", "min-width": "200px" }}>
                  <label class="form-label" for="ai-app-display">Display Name</label>
                  <input
                    id="ai-app-display"
                    class="form-input"
                    value={appDisplayName()}
                    onInput={(e) => setAppDisplayName(e.currentTarget.value)}
                    placeholder="e.g. E-Commerce Store"
                    disabled={generating()}
                  />
                </div>
                <div style={{ "min-width": "160px" }}>
                  <label class="form-label" for="ai-db-driver">Database</label>
                  <select
                    id="ai-db-driver"
                    class="form-input"
                    value={dbDriver()}
                    onChange={(e) => setDbDriver(e.currentTarget.value)}
                    disabled={generating()}
                  >
                    <option value="postgres">PostgreSQL</option>
                    <option value="sqlite">SQLite</option>
                  </select>
                </div>
              </div>
            </div>
          </Show>

          <div>
            <label class="form-label">Describe your application</label>
            <textarea
              class="form-input"
              rows={8}
              placeholder="E.g., A project management tool with projects, tasks, team members, and sprints. Tasks should have status tracking and priority levels..."
              value={prompt()}
              onInput={(e) => setPrompt(e.currentTarget.value)}
              disabled={generating() || !aiConfigured()}
            />
          </div>

          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">
              Or try an example:
            </p>
            <div class="flex flex-wrap gap-2">
              <For each={EXAMPLE_PROMPTS}>
                {(example) => (
                  <button
                    class="btn-secondary btn-sm"
                    onClick={() => setPrompt(example.prompt)}
                    disabled={generating() || !aiConfigured()}
                  >
                    {example.label}
                  </button>
                )}
              </For>
            </div>
          </div>

          <div>
            <button
              class="btn-primary"
              onClick={handleGenerate}
              disabled={
                generating() ||
                !prompt().trim() ||
                !aiConfigured() ||
                (isNewAppMode() && !appName().trim())
              }
            >
              {generating() ? (
                <span class="flex items-center gap-2">
                  <span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {isNewAppMode() ? "Creating App & Generating..." : "Generating..."}
                </span>
              ) : isNewAppMode() ? (
                "Create App & Generate Schema"
              ) : (
                "Generate Schema"
              )}
            </button>
          </div>
        </div>
      </Show>

      {/* Phase 2: Preview */}
      <Show when={phase() === "preview" && schema()}>
        {/* Summary */}
        <div class="flex flex-wrap gap-3 mb-4">
          <For
            each={[
              "entities",
              "relations",
              "rules",
              "state_machines",
              "permissions",
              "ui_configs",
            ]}
          >
            {(key) => (
              <Show when={sectionCount(key) > 0}>
                <span class="badge badge-blue text-xs">
                  {sectionCount(key)}{" "}
                  {key.replace(/_/g, " ")}
                </span>
              </Show>
            )}
          </For>
        </div>

        {/* Tabs */}
        <div class="flex border-b border-gray-200 dark:border-gray-700 mb-4 overflow-x-auto">
          <For each={[...TABS]}>
            {(tab) => (
              <button
                class={`px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
                  activeTab() === tab
                    ? "border-blue-500 text-blue-600 dark:text-blue-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
                onClick={() => setActiveTab(tab)}
              >
                {TAB_LABELS[tab]}
                <Show when={tab !== "raw" && sectionCount(tab) > 0}>
                  <span class="ml-1 text-xs opacity-60">
                    ({sectionCount(tab)})
                  </span>
                </Show>
              </button>
            )}
          </For>
        </div>

        {/* Tab Content */}
        <Show when={activeTab() !== "raw"}>
          <pre
            class="text-xs p-4 rounded-lg overflow-auto"
            style="background: #111827; color: #e5e7eb; max-height: 500px;"
          >
            {sectionData(activeTab())}
          </pre>
        </Show>

        <Show when={activeTab() === "raw"}>
          <textarea
            class="form-input font-mono text-xs"
            rows={24}
            value={rawJson()}
            onInput={(e) => setRawJson(e.currentTarget.value)}
          />
        </Show>

        {/* Actions */}
        <div class="flex gap-2 mt-4">
          <button class="btn-secondary" onClick={handleRegenerate}>
            Regenerate
          </button>
          <button
            class="btn-primary"
            onClick={handleApply}
            disabled={applying()}
          >
            {applying() ? (
              <span class="flex items-center gap-2">
                <span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Applying...
              </span>
            ) : (
              "Apply Schema"
            )}
          </button>
        </div>
      </Show>

      {/* Phase 3: Applied */}
      <Show when={phase() === "applied" && importResult()}>
        <div class="flex flex-col gap-4">
          <div
            class="p-4 rounded-lg border"
            style="background: var(--color-success-bg, #d4edda); border-color: var(--color-success-border, #28a745);"
          >
            <p class="text-sm font-medium mb-2">
              {importResult()!.message}
            </p>
            <div class="flex flex-wrap gap-3">
              <For each={Object.entries(importResult()!.summary)}>
                {([key, count]) => (
                  <Show when={count > 0}>
                    <span class="badge badge-green text-xs">
                      {count} {key.replace(/_/g, " ")}
                    </span>
                  </Show>
                )}
              </For>
            </div>
          </div>

          <Show
            when={
              importResult()!.errors && importResult()!.errors!.length > 0
            }
          >
            <div
              class="p-4 rounded-lg border"
              style="background: var(--color-error-bg, #f8d7da); border-color: var(--color-error-border, #dc3545);"
            >
              <p class="text-sm font-medium mb-2">
                Some items had errors:
              </p>
              <ul class="text-xs list-disc pl-4">
                <For each={importResult()!.errors!}>
                  {(err) => <li>{err}</li>}
                </For>
              </ul>
            </div>
          </Show>

          <div class="flex gap-2">
            <button
              class="btn-secondary"
              onClick={() => navigate("/entities")}
            >
              View Entities
            </button>
            <button class="btn-secondary" onClick={() => navigate("/data")}>
              Browse Data
            </button>
            <button class="btn-primary" onClick={handleNewGeneration}>
              Generate Another
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
