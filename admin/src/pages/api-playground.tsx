import { createSignal, createEffect, onMount, Show, For } from "solid-js";
import { rawRequest, type RawResponse } from "../api/client";
import { getSelectedApp } from "../stores/app";
import { useEntities } from "../stores/entities";
import { useRelations } from "../stores/relations";
import { parseDefinition, type EntityDefinition } from "../types/entity";
import { writableFields } from "../utils/field-helpers";
import { Badge } from "../components/badge";
import { addToast } from "../stores/notifications";

type PlaygroundMethod = "GET_LIST" | "GET_BY_ID" | "POST" | "PUT" | "DELETE";

interface FilterParam {
  field: string;
  operator: string;
  value: string;
}

interface HistoryEntry {
  id: number;
  timestamp: Date;
  method: PlaygroundMethod;
  entity: string;
  url: string;
  status: number;
  durationMs: number;
}

const OPERATORS = [
  { value: "eq", label: "=" },
  { value: "neq", label: "!=" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "like", label: "like" },
  { value: "in", label: "in" },
  { value: "not_in", label: "not in" },
];

let historyCounter = 0;

export function ApiPlayground() {
  const { entityNames, parsed, load: loadEntities } = useEntities();
  const { load: loadRelations, forSource } = useRelations();

  // Request builder
  const [selectedEntity, setSelectedEntity] = createSignal("");
  const [httpMethod, setHttpMethod] = createSignal<PlaygroundMethod>("GET_LIST");
  const [recordId, setRecordId] = createSignal("");
  const [requestBody, setRequestBody] = createSignal("");

  // GET list params
  const [filters, setFilters] = createSignal<FilterParam[]>([]);
  const [sortParam, setSortParam] = createSignal("");
  const [pageParam, setPageParam] = createSignal("1");
  const [perPageParam, setPerPageParam] = createSignal("25");
  const [includeParam, setIncludeParam] = createSignal("");

  // Response
  const [response, setResponse] = createSignal<RawResponse | null>(null);
  const [sending, setSending] = createSignal(false);

  // History
  const [history, setHistory] = createSignal<HistoryEntry[]>([]);

  // UI
  const [showHistory, setShowHistory] = createSignal(false);
  const [showHeaders, setShowHeaders] = createSignal(false);

  onMount(() => {
    loadEntities();
    loadRelations();
  });

  // Entity definition for selected entity
  const entityDef = (): EntityDefinition | undefined => {
    const name = selectedEntity();
    if (!name) return undefined;
    return parsed().find((e) => e.name === name);
  };

  // Available includes for the selected entity
  const availableIncludes = (): string[] => {
    const entity = selectedEntity();
    if (!entity) return [];
    return forSource(entity).map((r) => r.name);
  };

  // Auto-scaffold body when entity or method changes
  createEffect(() => {
    const entity = selectedEntity();
    const method = httpMethod();
    if ((method === "POST" || method === "PUT") && entity) {
      const def = entityDef();
      if (def) {
        setRequestBody(scaffoldBody(def, method === "POST"));
      }
    }
  });

  const needsRecordId = (): boolean =>
    ["GET_BY_ID", "PUT", "DELETE"].includes(httpMethod());

  const needsBody = (): boolean =>
    ["POST", "PUT"].includes(httpMethod());

  const needsInclude = (): boolean =>
    ["GET_LIST", "GET_BY_ID"].includes(httpMethod());

  const displayVerb = (): string => {
    const m = httpMethod();
    if (m === "GET_LIST" || m === "GET_BY_ID") return "GET";
    return m;
  };

  const canSend = (): boolean => {
    if (!selectedEntity()) return false;
    if (needsRecordId() && !recordId().trim()) return false;
    return true;
  };

  // Construct the request URL from current inputs
  const constructedUrl = (): string => {
    const entity = selectedEntity();
    if (!entity) return "";

    const method = httpMethod();
    switch (method) {
      case "GET_LIST": {
        const parts: string[] = [];
        for (const f of filters()) {
          if (!f.field || !f.value) continue;
          if (f.operator === "eq") {
            parts.push(`filter[${f.field}]=${encodeURIComponent(f.value)}`);
          } else {
            parts.push(`filter[${f.field}.${f.operator}]=${encodeURIComponent(f.value)}`);
          }
        }
        if (sortParam()) parts.push(`sort=${encodeURIComponent(sortParam())}`);
        if (pageParam() && pageParam() !== "1") parts.push(`page=${pageParam()}`);
        if (perPageParam() && perPageParam() !== "25") parts.push(`per_page=${perPageParam()}`);
        if (includeParam()) parts.push(`include=${encodeURIComponent(includeParam())}`);
        const qs = parts.length > 0 ? `?${parts.join("&")}` : "";
        return `/${entity}${qs}`;
      }
      case "GET_BY_ID": {
        const id = recordId().trim();
        const qs = includeParam() ? `?include=${encodeURIComponent(includeParam())}` : "";
        return `/${entity}/${id}${qs}`;
      }
      case "POST":
        return `/${entity}`;
      case "PUT":
        return `/${entity}/${recordId().trim()}`;
      case "DELETE":
        return `/${entity}/${recordId().trim()}`;
    }
  };

  // Filter management
  const addFilter = () => {
    setFilters((prev) => [...prev, { field: "", operator: "eq", value: "" }]);
  };

  const updateFilter = (index: number, key: keyof FilterParam, value: string) => {
    setFilters((prev) =>
      prev.map((f, i) => (i === index ? { ...f, [key]: value } : f)),
    );
  };

  const removeFilter = (index: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  };

  // Include toggle
  const toggleInclude = (name: string) => {
    const current = includeParam()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (current.includes(name)) {
      setIncludeParam(current.filter((s) => s !== name).join(","));
    } else {
      setIncludeParam([...current, name].join(","));
    }
  };

  // Send request
  const handleSend = async () => {
    const url = constructedUrl();
    if (!url) return;

    setSending(true);
    setResponse(null);
    setShowHeaders(false);

    try {
      const method = httpMethod();
      let httpVerb: string;
      let body: unknown | undefined;

      switch (method) {
        case "GET_LIST":
        case "GET_BY_ID":
          httpVerb = "GET";
          break;
        case "POST":
          httpVerb = "POST";
          body = JSON.parse(requestBody());
          break;
        case "PUT":
          httpVerb = "PUT";
          body = JSON.parse(requestBody());
          break;
        case "DELETE":
          httpVerb = "DELETE";
          break;
      }

      const result = await rawRequest(url, httpVerb!, body);
      setResponse(result);

      setHistory((prev) => {
        const next = [
          {
            id: ++historyCounter,
            timestamp: new Date(),
            method,
            entity: selectedEntity(),
            url,
            status: result.status,
            durationMs: result.durationMs,
          },
          ...prev,
        ];
        return next.slice(0, 20);
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        addToast("error", "Invalid JSON in request body");
      } else {
        addToast("error", `Request failed: ${String(err)}`);
      }
    } finally {
      setSending(false);
    }
  };

  // Status color for badge
  const statusColor = (status: number): "green" | "yellow" | "red" | "gray" => {
    if (status >= 200 && status < 300) return "green";
    if (status >= 400 && status < 500) return "yellow";
    if (status >= 500) return "red";
    return "gray";
  };

  // Copy response to clipboard
  const copyResponse = () => {
    const res = response();
    if (!res) return;
    const text =
      typeof res.body === "string" ? res.body : JSON.stringify(res.body, null, 2);
    navigator.clipboard.writeText(text);
    addToast("success", "Response copied to clipboard");
  };

  // Reset body scaffold
  const resetScaffold = () => {
    const def = entityDef();
    if (def) {
      setRequestBody(scaffoldBody(def, httpMethod() === "POST"));
    }
  };

  // Replay from history
  const replayFromHistory = (entry: HistoryEntry) => {
    setSelectedEntity(entry.entity);
    setHttpMethod(entry.method);
  };

  // Method badge color
  const methodColor = (method: PlaygroundMethod): "blue" | "green" | "yellow" | "red" => {
    switch (method) {
      case "GET_LIST":
      case "GET_BY_ID":
        return "blue";
      case "POST":
        return "green";
      case "PUT":
        return "yellow";
      case "DELETE":
        return "red";
    }
  };

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">API Playground</h1>
          <p class="page-subtitle">Test your entity APIs with an interactive REST client</p>
        </div>
        <div class="flex items-center gap-3">
          <Show when={history().length > 0}>
            <button
              class="btn-secondary btn-sm"
              onClick={() => setShowHistory(!showHistory())}
            >
              {showHistory() ? "Hide History" : `History (${history().length})`}
            </button>
          </Show>
        </div>
      </div>

      <div class="playground-layout">
        {/* ── Request Builder ──────────────────── */}
        <div class="playground-panel">
          <div class="playground-panel-title">Request</div>

          {/* Entity + Method */}
          <div class="form-row mb-4">
            <div class="form-group">
              <label class="form-label">Entity</label>
              <select
                class="form-select"
                value={selectedEntity()}
                onChange={(e) => setSelectedEntity(e.currentTarget.value)}
              >
                <option value="">Select entity...</option>
                <For each={entityNames()}>
                  {(name) => <option value={name}>{name}</option>}
                </For>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Method</label>
              <select
                class="form-select"
                value={httpMethod()}
                onChange={(e) => setHttpMethod(e.currentTarget.value as PlaygroundMethod)}
              >
                <option value="GET_LIST">GET - List</option>
                <option value="GET_BY_ID">GET - By ID</option>
                <option value="POST">POST - Create</option>
                <option value="PUT">PUT - Update</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
          </div>

          {/* Record ID */}
          <Show when={needsRecordId()}>
            <div class="form-group mb-4">
              <label class="form-label">Record ID</label>
              <input
                type="text"
                class="form-input font-mono text-sm"
                placeholder="UUID or ID of the record"
                value={recordId()}
                onInput={(e) => setRecordId(e.currentTarget.value)}
              />
            </div>
          </Show>

          {/* GET List Params */}
          <Show when={httpMethod() === "GET_LIST"}>
            <div class="mb-4">
              <label class="form-label mb-2">Filters</label>
              <div class="space-y-2">
                <For each={filters()}>
                  {(filter, i) => (
                    <div class="playground-filter-row">
                      <select
                        class="form-select"
                        value={filter.field}
                        onChange={(e) => updateFilter(i(), "field", e.currentTarget.value)}
                      >
                        <option value="">Field...</option>
                        <For each={entityDef()?.fields ?? []}>
                          {(f) => <option value={f.name}>{f.name}</option>}
                        </For>
                      </select>
                      <select
                        class="form-select"
                        style={{ "max-width": "100px" }}
                        value={filter.operator}
                        onChange={(e) => updateFilter(i(), "operator", e.currentTarget.value)}
                      >
                        <For each={OPERATORS}>
                          {(op) => <option value={op.value}>{op.label}</option>}
                        </For>
                      </select>
                      <input
                        type="text"
                        class="form-input"
                        placeholder="Value"
                        value={filter.value}
                        onInput={(e) => updateFilter(i(), "value", e.currentTarget.value)}
                      />
                      <button
                        class="btn-ghost btn-sm"
                        onClick={() => removeFilter(i())}
                        title="Remove filter"
                      >
                        x
                      </button>
                    </div>
                  )}
                </For>
              </div>
              <button class="btn-secondary btn-sm mt-2" onClick={addFilter}>
                + Add Filter
              </button>
            </div>

            <div class="form-row mb-4">
              <div class="form-group">
                <label class="form-label">Sort</label>
                <input
                  type="text"
                  class="form-input text-sm"
                  placeholder="field1,-field2"
                  value={sortParam()}
                  onInput={(e) => setSortParam(e.currentTarget.value)}
                />
              </div>
              <div class="form-group">
                <label class="form-label">Include</label>
                <input
                  type="text"
                  class="form-input text-sm"
                  placeholder="relation1,relation2"
                  value={includeParam()}
                  onInput={(e) => setIncludeParam(e.currentTarget.value)}
                />
                <Show when={availableIncludes().length > 0}>
                  <p class="text-xs text-gray-400 mt-1">
                    Available:{" "}
                    <For each={availableIncludes()}>
                      {(r, i) => (
                        <>
                          <Show when={i() > 0}>, </Show>
                          <span
                            class="text-blue-600 cursor-pointer hover:underline"
                            onClick={() => toggleInclude(r)}
                          >
                            {r}
                          </span>
                        </>
                      )}
                    </For>
                  </p>
                </Show>
              </div>
            </div>

            <div class="form-row mb-4">
              <div class="form-group">
                <label class="form-label">Page</label>
                <input
                  type="number"
                  class="form-input text-sm"
                  min="1"
                  value={pageParam()}
                  onInput={(e) => setPageParam(e.currentTarget.value)}
                />
              </div>
              <div class="form-group">
                <label class="form-label">Per Page</label>
                <input
                  type="number"
                  class="form-input text-sm"
                  min="1"
                  max="100"
                  value={perPageParam()}
                  onInput={(e) => setPerPageParam(e.currentTarget.value)}
                />
              </div>
            </div>
          </Show>

          {/* Include for GET by ID */}
          <Show when={httpMethod() === "GET_BY_ID"}>
            <div class="form-group mb-4">
              <label class="form-label">Include</label>
              <input
                type="text"
                class="form-input text-sm"
                placeholder="relation1,relation2"
                value={includeParam()}
                onInput={(e) => setIncludeParam(e.currentTarget.value)}
              />
              <Show when={availableIncludes().length > 0}>
                <p class="text-xs text-gray-400 mt-1">
                  Available:{" "}
                  <For each={availableIncludes()}>
                    {(r, i) => (
                      <>
                        <Show when={i() > 0}>, </Show>
                        <span
                          class="text-blue-600 cursor-pointer hover:underline"
                          onClick={() => toggleInclude(r)}
                        >
                          {r}
                        </span>
                      </>
                    )}
                  </For>
                </p>
              </Show>
            </div>
          </Show>

          {/* Request Body */}
          <Show when={needsBody()}>
            <div class="form-group mb-4">
              <div class="flex items-center justify-between mb-1">
                <label class="form-label">Request Body (JSON)</label>
                <button class="btn-ghost btn-sm" onClick={resetScaffold}>
                  Reset Template
                </button>
              </div>
              <textarea
                class="form-input font-mono text-sm"
                rows={12}
                value={requestBody()}
                onInput={(e) => setRequestBody(e.currentTarget.value)}
                spellcheck={false}
              />
            </div>
          </Show>

          {/* URL Preview */}
          <Show when={selectedEntity()}>
            <div class="playground-url-preview">
              <span class="playground-url-method">{displayVerb()}</span>
              /api/{getSelectedApp()}{constructedUrl()}
            </div>
          </Show>

          {/* Send Button */}
          <button
            class="btn-primary w-full"
            disabled={!canSend() || sending()}
            onClick={handleSend}
          >
            {sending() ? "Sending..." : "Send Request"}
          </button>
        </div>

        {/* ── Response Panel ──────────────────── */}
        <div class="playground-panel">
          <div class="playground-panel-title">Response</div>

          <Show
            when={response()}
            fallback={
              <div class="playground-empty">
                {sending() ? "Sending request..." : "Send a request to see the response here."}
              </div>
            }
          >
            {(res) => {
              const formatted = () =>
                typeof res().body === "string"
                  ? (res().body as string)
                  : JSON.stringify(res().body, null, 2);
              return (
                <>
                  <div class="playground-response-meta">
                    <Badge label={String(res().status)} color={statusColor(res().status)} />
                    <span class="text-sm text-gray-500">{res().statusText}</span>
                    <span class="text-sm text-gray-400">{res().durationMs}ms</span>
                    <button class="btn-ghost btn-sm ml-auto" onClick={copyResponse}>
                      Copy
                    </button>
                  </div>

                  <pre class="playground-response-body">{formatted()}</pre>

                  <button
                    class="btn-ghost btn-sm mt-3"
                    onClick={() => setShowHeaders(!showHeaders())}
                  >
                    {showHeaders() ? "Hide Headers" : "Show Headers"}
                  </button>
                  <Show when={showHeaders()}>
                    <pre class="playground-headers">
                      {Object.entries(res().headers)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join("\n")}
                    </pre>
                  </Show>
                </>
              );
            }}
          </Show>
        </div>
      </div>

      {/* ── History Panel ──────────────────── */}
      <Show when={showHistory() && history().length > 0}>
        <div class="playground-panel mt-6">
          <div class="playground-panel-title">Recent Requests</div>
          <For each={history()}>
            {(entry) => (
              <div
                class="playground-history-row"
                onClick={() => replayFromHistory(entry)}
                title="Click to load this request"
              >
                <Badge label={displayVerbForMethod(entry.method)} color={methodColor(entry.method)} />
                <span class="font-medium text-sm">{entry.entity}</span>
                <span class="font-mono text-xs text-gray-500 truncate flex-1">
                  {entry.url}
                </span>
                <Badge label={String(entry.status)} color={statusColor(entry.status)} />
                <span class="text-gray-400 text-xs">{entry.durationMs}ms</span>
                <span class="text-gray-400 text-xs">
                  {entry.timestamp.toLocaleTimeString()}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function displayVerbForMethod(method: PlaygroundMethod): string {
  if (method === "GET_LIST" || method === "GET_BY_ID") return "GET";
  return method;
}

function scaffoldBody(def: EntityDefinition, isCreate: boolean): string {
  const fields = writableFields(def, isCreate);
  const obj: Record<string, unknown> = {};

  for (const f of fields) {
    if (f.enum && f.enum.length > 0) {
      obj[f.name] = f.enum[0];
      continue;
    }
    switch (f.type) {
      case "string":
        obj[f.name] = "";
        break;
      case "text":
        obj[f.name] = "";
        break;
      case "int":
      case "bigint":
        obj[f.name] = 0;
        break;
      case "decimal":
        obj[f.name] = 0.0;
        break;
      case "boolean":
        obj[f.name] = false;
        break;
      case "uuid":
        obj[f.name] = "00000000-0000-0000-0000-000000000000";
        break;
      case "timestamp":
        obj[f.name] = new Date().toISOString();
        break;
      case "date":
        obj[f.name] = new Date().toISOString().split("T")[0];
        break;
      case "json":
        obj[f.name] = {};
        break;
      case "file":
        obj[f.name] = "file-uuid-here";
        break;
      default:
        obj[f.name] = "";
    }
  }

  return JSON.stringify(obj, null, 2);
}
