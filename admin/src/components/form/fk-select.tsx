import { createSignal, onMount, For, Show } from "solid-js";
import { listRecords } from "../../api/data";
import type { EntityDefinition } from "../../types/entity";

export interface FkFieldInfo {
  /** The FK field name on this entity (e.g. "author_id") */
  fieldName: string;
  /** The related entity to look up (e.g. "authors") */
  targetEntity: string;
  /** The key on the related entity (e.g. "id") */
  targetKey: string;
  /** The target entity definition (pre-loaded) */
  targetDef?: EntityDefinition;
}

interface FkSelectProps {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  required?: boolean;
  error?: string;
  fkInfo: FkFieldInfo;
  compact?: boolean;
}

interface Option {
  value: string;
  display: string;
}

/** Pick a human-readable display field from an entity's fields */
function pickDisplayField(fields: { name: string; type: string; auto?: string }[], pkField: string): string | null {
  const preferred = ["name", "title", "label", "display_name", "email", "username", "slug"];
  for (const name of preferred) {
    if (fields.some((f) => f.name === name)) return name;
  }
  const systemFields = new Set([pkField, "id", "created_at", "updated_at", "deleted_at"]);
  const stringField = fields.find(
    (f) => (f.type === "string" || f.type === "text") && !systemFields.has(f.name) && !f.auto
  );
  return stringField?.name || null;
}

export function FkSelect(props: FkSelectProps) {
  const [options, setOptions] = createSignal<Option[]>([]);
  const [loading, setLoading] = createSignal(true);

  onMount(() => {
    loadOptions();
  });

  async function loadOptions() {
    setLoading(true);
    try {
      const def = props.fkInfo.targetDef;
      const pkField = def?.primary_key.field ?? "id";
      const displayField = def ? pickDisplayField(def.fields, pkField) : null;

      const res = await listRecords(props.fkInfo.targetEntity, { perPage: 200 });
      const opts: Option[] = (res.data ?? []).map((row: Record<string, unknown>) => {
        const pk = String(row[props.fkInfo.targetKey] ?? row[pkField] ?? "");
        const display = displayField
          ? String(row[displayField] ?? pk)
          : pk;
        return { value: pk, display };
      });
      setOptions(opts);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }

  if (props.compact) {
    // Compact mode for inline table editing
    return (
      <div>
        <Show
          when={!loading()}
          fallback={
            <select class="form-select rel-editor-inline-input" disabled>
              <option>Loading...</option>
            </select>
          }
        >
          <select
            class={`form-select rel-editor-inline-input${props.error ? " form-input-error" : ""}`}
            value={String(props.value ?? "")}
            onChange={(e) => props.onChange(e.currentTarget.value || null)}
          >
            <option value="">--</option>
            <For each={options()}>
              {(opt) => (
                <option value={opt.value}>{opt.display}</option>
              )}
            </For>
          </select>
        </Show>
        <Show when={props.error}>
          <div class="form-error-text">{props.error}</div>
        </Show>
      </div>
    );
  }

  // Full mode for form editing
  return (
    <div class="form-group">
      <label class={props.required ? "form-label text-red-500" : "form-label"}>
        {props.label}
        {props.required && <span class="text-red-500 dark:text-red-400 ml-1">*</span>}
        <span class="text-gray-400 dark:text-gray-500 ml-2 text-xs font-normal">
          → {props.fkInfo.targetEntity}
        </span>
      </label>
      <Show
        when={!loading()}
        fallback={
          <select class="form-select" disabled>
            <option>Loading...</option>
          </select>
        }
      >
        <select
          class={`form-select${props.error ? " form-input-error" : ""}`}
          value={String(props.value ?? "")}
          onChange={(e) => props.onChange(e.currentTarget.value || null)}
        >
          <option value="">Select {props.fkInfo.targetEntity}...</option>
          <For each={options()}>
            {(opt) => (
              <option value={opt.value}>{opt.display}</option>
            )}
          </For>
        </select>
      </Show>
      <Show when={props.error}>
        <span class="text-red-500 dark:text-red-400 text-xs mt-1">{props.error}</span>
      </Show>
    </div>
  );
}
