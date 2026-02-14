import { createSignal, createEffect, For, Show } from "solid-js";
import type { Field } from "../../types/entity";

export interface ExpressionBuilderProps {
  value: string;
  onChange: (expr: string) => void;
  fields?: Field[];
  vars?: string[];
  placeholder?: string;
  helpText?: string;
}

interface ExprRow {
  left: string;
  operator: string;
  right: string;
}

const COMPARISON_OPS = [
  { value: "==", label: "==" },
  { value: "!=", label: "!=" },
  { value: ">", label: ">" },
  { value: ">=", label: ">=" },
  { value: "<", label: "<" },
  { value: "<=", label: "<=" },
];

const STRING_OPS = [
  { value: "==", label: "==" },
  { value: "!=", label: "!=" },
  { value: "contains", label: "contains" },
  { value: "startsWith", label: "starts with" },
  { value: "endsWith", label: "ends with" },
];

const BOOL_OPS = [
  { value: "==", label: "==" },
  { value: "!=", label: "!=" },
];

function getOpsForField(fieldName: string, fields?: Field[]): { value: string; label: string }[] {
  if (!fields) return COMPARISON_OPS;
  // Extract bare field name from "record.fieldName"
  const bare = fieldName.includes(".") ? fieldName.split(".").pop()! : fieldName;
  const field = fields.find((f) => f.name === bare);
  if (!field) return COMPARISON_OPS;
  if (field.type === "string" || field.type === "text") return STRING_OPS;
  if (field.type === "boolean") return BOOL_OPS;
  return COMPARISON_OPS;
}

/** Try to parse a simple expression into visual rows. Returns null if too complex. */
function parseExpression(expr: string): { rows: ExprRow[]; combinator: "&&" | "||" } | null {
  const trimmed = expr.trim();
  if (!trimmed) return { rows: [], combinator: "&&" };

  // Detect combinator
  const hasAnd = trimmed.includes("&&");
  const hasOr = trimmed.includes("||");
  if (hasAnd && hasOr) return null; // Mixed combinators → advanced mode

  const combinator = hasOr ? "||" : "&&";
  const parts = trimmed.split(combinator === "&&" ? /\s*&&\s*/ : /\s*\|\|\s*/);

  const rows: ExprRow[] = [];
  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;

    // Match: left op right (with optional quotes around right)
    const m = p.match(/^(.+?)\s*(==|!=|>=|<=|>|<|contains|startsWith|endsWith)\s*(.+)$/);
    if (!m) return null; // Unparseable part → advanced mode

    const left = m[1].trim();
    const operator = m[2].trim();
    let right = m[3].trim();
    // Strip quotes from right side for display
    if ((right.startsWith('"') && right.endsWith('"')) || (right.startsWith("'") && right.endsWith("'"))) {
      right = right.slice(1, -1);
    }

    rows.push({ left, operator, right });
  }

  return { rows, combinator };
}

/** Generate expression string from visual rows */
function rowsToExpression(rows: ExprRow[], combinator: "&&" | "||"): string {
  return rows
    .filter((r) => r.left.trim())
    .map((r) => {
      const right = formatValue(r.right);
      if (r.operator === "contains") return `${r.left}.contains(${right})`;
      if (r.operator === "startsWith") return `${r.left}.startsWith(${right})`;
      if (r.operator === "endsWith") return `${r.left}.endsWith(${right})`;
      return `${r.left} ${r.operator} ${right}`;
    })
    .join(` ${combinator} `);
}

function formatValue(val: string): string {
  const trimmed = val.trim();
  if (!trimmed) return '""';
  // Already looks like a field reference (has dots or is a known keyword)
  if (/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(trimmed)) {
    // Check if it's a number, boolean, or null
    if (!isNaN(Number(trimmed))) return trimmed;
    if (trimmed === "true" || trimmed === "false" || trimmed === "null") return trimmed;
    // Could be a field reference like record.other_field or a plain string
    if (trimmed.includes(".")) return trimmed; // Likely a field reference
    // Bare word → quote it as a string
    return `"${trimmed}"`;
  }
  // Already quoted or contains special chars → use as-is if quoted, else quote
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed;
  }
  return `"${trimmed.replace(/"/g, '\\"')}"`;
}

export function ExpressionBuilder(props: ExpressionBuilderProps) {
  const [mode, setMode] = createSignal<"visual" | "advanced">("visual");
  const [rows, setRows] = createSignal<ExprRow[]>([]);
  const [combinator, setCombinator] = createSignal<"&&" | "||">("&&");
  const [rawValue, setRawValue] = createSignal(props.value);

  // Parse initial value into rows
  createEffect(() => {
    const parsed = parseExpression(props.value);
    if (parsed) {
      setRows(parsed.rows);
      setCombinator(parsed.combinator);
      setMode("visual");
    } else {
      setMode("advanced");
    }
    setRawValue(props.value);
  });

  // Field options for the left-side dropdown
  const fieldOptions = () => {
    const options: { value: string; label: string }[] = [];
    if (props.fields) {
      for (const f of props.fields) {
        options.push({ value: `record.${f.name}`, label: `record.${f.name}` });
      }
    }
    if (props.vars) {
      for (const v of props.vars) {
        if (v === "record" || v === "old") continue; // Already covered by field expansion
        options.push({ value: v, label: v });
      }
      // Add old.* fields if "old" is in vars
      if (props.vars.includes("old") && props.fields) {
        for (const f of props.fields) {
          options.push({ value: `old.${f.name}`, label: `old.${f.name}` });
        }
      }
    }
    return options;
  };

  const updateRow = (index: number, partial: Partial<ExprRow>) => {
    const updated = [...rows()];
    updated[index] = { ...updated[index], ...partial };
    setRows(updated);
    props.onChange(rowsToExpression(updated, combinator()));
  };

  const addRow = () => {
    const updated = [...rows(), { left: "", operator: "==", right: "" }];
    setRows(updated);
  };

  const removeRow = (index: number) => {
    const updated = rows().filter((_, i) => i !== index);
    setRows(updated);
    props.onChange(rowsToExpression(updated, combinator()));
  };

  const toggleCombinator = () => {
    const next = combinator() === "&&" ? "||" : "&&";
    setCombinator(next);
    props.onChange(rowsToExpression(rows(), next));
  };

  const handleAdvancedChange = (val: string) => {
    setRawValue(val);
    props.onChange(val);
  };

  const switchToVisual = () => {
    const parsed = parseExpression(rawValue());
    if (parsed) {
      setRows(parsed.rows);
      setCombinator(parsed.combinator);
      setMode("visual");
    }
  };

  const switchToAdvanced = () => {
    setRawValue(props.value);
    setMode("advanced");
  };

  const preview = () => rowsToExpression(rows(), combinator());

  return (
    <div class="expr-builder">
      <div class="expr-builder-header">
        <Show when={props.helpText}>
          <span class="text-xs text-gray-500">{props.helpText}</span>
        </Show>
        <div class="expr-mode-toggle">
          <button
            class={`expr-mode-btn ${mode() === "visual" ? "expr-mode-active" : ""}`}
            onClick={() => { if (mode() !== "visual") switchToVisual(); }}
            disabled={mode() === "visual"}
            title={mode() === "advanced" ? (parseExpression(rawValue()) ? "Switch to visual" : "Expression too complex for visual mode") : ""}
          >
            Visual
          </button>
          <button
            class={`expr-mode-btn ${mode() === "advanced" ? "expr-mode-active" : ""}`}
            onClick={() => { if (mode() !== "advanced") switchToAdvanced(); }}
          >
            Advanced
          </button>
        </div>
      </div>

      {/* Visual mode */}
      <Show when={mode() === "visual"}>
        <div class="expr-rows">
          <For each={rows()}>
            {(row, i) => (
              <>
                <Show when={i() > 0}>
                  <div class="expr-combinator">
                    <button class="expr-combinator-btn" onClick={toggleCombinator}>
                      {combinator() === "&&" ? "AND" : "OR"}
                    </button>
                  </div>
                </Show>
                <div class="expr-row">
                  {/* Left side - field/var picker with custom input fallback */}
                  <div class="expr-field-wrap">
                    <input
                      type="text"
                      class="form-input expr-field-input"
                      list={`expr-fields-${i()}`}
                      value={row.left}
                      onInput={(e) => updateRow(i(), { left: e.currentTarget.value })}
                      placeholder="record.field"
                    />
                    <datalist id={`expr-fields-${i()}`}>
                      <For each={fieldOptions()}>
                        {(opt) => <option value={opt.value}>{opt.label}</option>}
                      </For>
                    </datalist>
                  </div>
                  {/* Operator */}
                  <select
                    class="form-select expr-op-select"
                    value={row.operator}
                    onChange={(e) => updateRow(i(), { operator: e.currentTarget.value })}
                  >
                    <For each={getOpsForField(row.left, props.fields)}>
                      {(op) => <option value={op.value}>{op.label}</option>}
                    </For>
                  </select>
                  {/* Right side - value */}
                  <input
                    type="text"
                    class="form-input expr-value-input"
                    value={row.right}
                    onInput={(e) => updateRow(i(), { right: e.currentTarget.value })}
                    placeholder="value"
                  />
                  <button class="btn-icon" onClick={() => removeRow(i())} title="Remove">
                    ✕
                  </button>
                </div>
              </>
            )}
          </For>
        </div>
        <div class="expr-actions">
          <button class="btn-secondary btn-sm" onClick={addRow}>
            + Add Condition
          </button>
        </div>
        <Show when={rows().length > 0 && preview()}>
          <div class="expr-preview">
            <span class="text-xs text-gray-400">Preview:</span>
            <code class="expr-preview-code">{preview()}</code>
          </div>
        </Show>
      </Show>

      {/* Advanced mode */}
      <Show when={mode() === "advanced"}>
        <textarea
          class="form-input font-mono"
          rows={3}
          value={rawValue()}
          onInput={(e) => handleAdvancedChange(e.currentTarget.value)}
          placeholder={props.placeholder}
        />
        <Show when={props.vars && props.vars.length > 0}>
          <span class="text-xs text-gray-500">
            Available: {props.vars!.join(", ")}
          </span>
        </Show>
      </Show>
    </div>
  );
}
