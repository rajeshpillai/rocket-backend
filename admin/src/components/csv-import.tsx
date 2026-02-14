import { createSignal, For, Show } from "solid-js";
import type { EntityDefinition } from "../types/entity";
import { createRecord } from "../api/data";
import { isApiError } from "../types/api";

interface CsvImportProps {
  entity: EntityDefinition;
  onDone: (imported: number) => void;
  onCancel: () => void;
}

interface ImportResult {
  row: number;
  success: boolean;
  error?: string;
}

/** Parse CSV text into rows of string arrays. Handles quoted fields and embedded commas/newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const row: string[] = [];
    while (i < len) {
      let value = "";
      if (text[i] === '"') {
        // Quoted field
        i++; // skip opening quote
        while (i < len) {
          if (text[i] === '"') {
            if (i + 1 < len && text[i + 1] === '"') {
              value += '"';
              i += 2;
            } else {
              i++; // skip closing quote
              break;
            }
          } else {
            value += text[i];
            i++;
          }
        }
      } else {
        // Unquoted field
        while (i < len && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          value += text[i];
          i++;
        }
      }
      row.push(value);

      if (i < len && text[i] === ',') {
        i++; // skip comma
        continue;
      }
      // End of row
      if (i < len && text[i] === '\r') i++;
      if (i < len && text[i] === '\n') i++;
      break;
    }
    if (row.length > 0 && !(row.length === 1 && row[0] === "")) {
      rows.push(row);
    }
  }
  return rows;
}

/** Coerce a string value to the appropriate JS type based on field type */
function coerceValue(value: string, fieldType: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "null") return null;

  switch (fieldType) {
    case "int":
    case "bigint": {
      const n = parseInt(trimmed, 10);
      return isNaN(n) ? trimmed : n;
    }
    case "decimal": {
      const n = parseFloat(trimmed);
      return isNaN(n) ? trimmed : n;
    }
    case "boolean":
      return trimmed === "true" || trimmed === "1" || trimmed === "yes";
    case "json":
      try { return JSON.parse(trimmed); } catch { return trimmed; }
    default:
      return trimmed;
  }
}

export function CsvImport(props: CsvImportProps) {
  const [step, setStep] = createSignal<"upload" | "preview" | "importing" | "done">("upload");
  const [csvHeaders, setCsvHeaders] = createSignal<string[]>([]);
  const [csvRows, setCsvRows] = createSignal<string[][]>([]);
  const [columnMap, setColumnMap] = createSignal<Record<number, string>>({});
  const [results, setResults] = createSignal<ImportResult[]>([]);
  const [progress, setProgress] = createSignal(0);
  const [parseError, setParseError] = createSignal<string | null>(null);

  const entityFields = () => props.entity.fields.map((f) => f.name);
  const fieldTypeMap = () => {
    const map: Record<string, string> = {};
    for (const f of props.entity.fields) map[f.name] = f.type;
    map[props.entity.primary_key.field] = props.entity.primary_key.type;
    return map;
  };

  const handleFileSelect = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    setParseError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const rows = parseCsv(text);
      if (rows.length < 2) {
        setParseError("CSV must have a header row and at least one data row");
        return;
      }

      const headers = rows[0];
      const dataRows = rows.slice(1);
      setCsvHeaders(headers);
      setCsvRows(dataRows);

      // Auto-map columns by matching header names to entity fields
      const fields = entityFields();
      const map: Record<number, string> = {};
      headers.forEach((h, idx) => {
        const normalized = h.trim().toLowerCase();
        const match = fields.find((f) => f.toLowerCase() === normalized);
        if (match) map[idx] = match;
      });
      setColumnMap(map);
      setStep("preview");
    };
    reader.readAsText(file);
  };

  const updateMapping = (csvIndex: number, fieldName: string) => {
    setColumnMap((prev) => {
      const next = { ...prev };
      if (fieldName === "") {
        delete next[csvIndex];
      } else {
        next[csvIndex] = fieldName;
      }
      return next;
    });
  };

  const mappedFieldCount = () => Object.keys(columnMap()).length;

  const previewRows = () => csvRows().slice(0, 5);

  const handleImport = async () => {
    setStep("importing");
    setProgress(0);
    setResults([]);

    const rows = csvRows();
    const map = columnMap();
    const types = fieldTypeMap();
    const importResults: ImportResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const record: Record<string, unknown> = {};

      for (const [csvIdx, fieldName] of Object.entries(map)) {
        const rawValue = row[Number(csvIdx)] ?? "";
        record[fieldName] = coerceValue(rawValue, types[fieldName] ?? "string");
      }

      try {
        await createRecord(props.entity.name, record);
        importResults.push({ row: i + 1, success: true });
      } catch (err) {
        let msg = "Unknown error";
        if (isApiError(err)) {
          msg = err.error.message;
          if (err.error.details) {
            msg += ": " + err.error.details.map((d) => `${d.field ?? ""} ${d.message}`).join(", ");
          }
        }
        importResults.push({ row: i + 1, success: false, error: msg });
      }

      setProgress(i + 1);
      setResults([...importResults]);
    }

    setStep("done");
  };

  const successCount = () => results().filter((r) => r.success).length;
  const failCount = () => results().filter((r) => !r.success).length;

  return (
    <div class="csv-import">
      {/* Step 1: Upload */}
      <Show when={step() === "upload"}>
        <div class="csv-upload-area">
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">
            Upload a CSV file to import records into <strong>{props.entity.name}</strong>.
            The first row should contain column headers.
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileSelect}
            class="form-input"
          />
          <Show when={parseError()}>
            <p class="text-sm text-red-600 dark:text-red-400 mt-2">{parseError()}</p>
          </Show>
        </div>
      </Show>

      {/* Step 2: Preview + column mapping */}
      <Show when={step() === "preview"}>
        <div class="csv-preview">
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">
            {csvRows().length} row(s) found. Map CSV columns to entity fields:
          </p>

          {/* Column mapping */}
          <div class="csv-mapping-grid">
            <For each={csvHeaders()}>
              {(header, idx) => (
                <div class="csv-mapping-row">
                  <span class="csv-mapping-header" title={header}>{header}</span>
                  <span class="csv-mapping-arrow">&rarr;</span>
                  <select
                    class="form-select csv-mapping-select"
                    value={columnMap()[idx()] ?? ""}
                    onChange={(e) => updateMapping(idx(), e.currentTarget.value)}
                  >
                    <option value="">(skip)</option>
                    <For each={entityFields()}>
                      {(field) => <option value={field}>{field}</option>}
                    </For>
                  </select>
                </div>
              )}
            </For>
          </div>

          {/* Preview table */}
          <Show when={previewRows().length > 0}>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-4 mb-2">
              Preview (first {Math.min(5, csvRows().length)} rows):
            </p>
            <div class="csv-preview-table-wrap">
              <table class="data-table">
                <thead class="table-header">
                  <tr>
                    <For each={csvHeaders()}>
                      {(h, idx) => (
                        <th class="table-header-cell">
                          <div class="text-xs">
                            <div class="text-gray-400 dark:text-gray-500">{h}</div>
                            <Show when={columnMap()[idx()]}>
                              <div class="text-blue-600 dark:text-blue-400">&darr; {columnMap()[idx()]}</div>
                            </Show>
                          </div>
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody class="table-body">
                  <For each={previewRows()}>
                    {(row) => (
                      <tr class="table-row">
                        <For each={row}>
                          {(cell) => (
                            <td class="table-cell text-xs">{cell || <span class="text-gray-300 dark:text-gray-600">empty</span>}</td>
                          )}
                        </For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>

          <div class="flex items-center justify-between mt-4">
            <button class="btn-secondary btn-sm" onClick={() => setStep("upload")}>
              Back
            </button>
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {mappedFieldCount()} field(s) mapped
              </span>
              <button
                class="btn-primary btn-sm"
                onClick={handleImport}
                disabled={mappedFieldCount() === 0}
              >
                Import {csvRows().length} Row(s)
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* Step 3: Importing */}
      <Show when={step() === "importing"}>
        <div class="csv-progress">
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">
            Importing... {progress()} / {csvRows().length}
          </p>
          <div class="csv-progress-bar">
            <div
              class="csv-progress-fill"
              style={{ width: `${(progress() / csvRows().length) * 100}%` }}
            />
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-2">
            {successCount()} succeeded, {failCount()} failed
          </div>
        </div>
      </Show>

      {/* Step 4: Done */}
      <Show when={step() === "done"}>
        <div class="csv-results">
          <p class="text-sm mb-3">
            <span class="text-green-600 dark:text-green-400 font-medium">{successCount()} imported</span>
            {failCount() > 0 && (
              <span class="text-red-600 dark:text-red-400 font-medium ml-2">{failCount()} failed</span>
            )}
            <span class="text-gray-500 dark:text-gray-400 ml-2">of {csvRows().length} total</span>
          </p>

          {/* Show errors if any */}
          <Show when={failCount() > 0}>
            <div class="csv-error-list">
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">Failed rows:</p>
              <div class="csv-error-scroll">
                <For each={results().filter((r) => !r.success)}>
                  {(r) => (
                    <div class="csv-error-item">
                      <span class="font-medium">Row {r.row}:</span> {r.error}
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <div class="flex items-center justify-end mt-4 gap-3">
            <button class="btn-primary btn-sm" onClick={() => props.onDone(successCount())}>
              Done
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
