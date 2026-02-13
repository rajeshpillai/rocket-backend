import { createSignal, onMount, For, Show } from "solid-js";
import { listRecords, getEntity } from "../api/data";
import { parseDefinition, type Field } from "../types/entity";

interface FkSelectProps {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  required?: boolean;
  error?: string;
  targetEntity: string;
  targetKey: string;
}

interface Option {
  value: string;
  display: string;
}

export default function FkSelect(props: FkSelectProps) {
  const [options, setOptions] = createSignal<Option[]>([]);
  const [loading, setLoading] = createSignal(true);

  onMount(() => {
    loadOptions();
  });

  async function loadOptions() {
    setLoading(true);
    try {
      // Load entity definition to find display field
      const entityRow = await getEntity(props.targetEntity);
      const def = parseDefinition(entityRow);
      const displayField = pickDisplayField(def.fields, def.primary_key.field);

      // Load records (up to 200 for dropdown)
      const res = await listRecords(props.targetEntity, { per_page: 200 });
      const opts: Option[] = res.data.map((row) => {
        const pk = String(row[props.targetKey] ?? row[def.primary_key.field] ?? "");
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

  const labelClass = props.required ? "form-label form-label-required" : "form-label";

  return (
    <div class="form-group">
      <label class={labelClass}>{props.label}</label>
      <Show
        when={!loading()}
        fallback={
          <select class="form-select" disabled>
            <option>Loading...</option>
          </select>
        }
      >
        <select
          class={`form-select ${props.error ? "form-input-error" : ""}`}
          value={String(props.value ?? "")}
          onChange={(e) => {
            const v = e.currentTarget.value;
            props.onChange(v || null);
          }}
        >
          <option value="">Select {props.targetEntity}...</option>
          <For each={options()}>
            {(opt) => (
              <option value={opt.value}>
                {opt.display}
              </option>
            )}
          </For>
        </select>
      </Show>
      <Show when={props.error}>
        <span class="form-error-text">{props.error}</span>
      </Show>
    </div>
  );
}

function pickDisplayField(fields: Field[], pkField: string): string | null {
  // Prefer common display field names
  const preferred = ["name", "title", "label", "display_name", "email", "username", "slug"];
  for (const name of preferred) {
    if (fields.some((f) => f.name === name)) return name;
  }
  // Fall back to first string field that isn't the PK or a system field
  const systemFields = new Set([pkField, "id", "created_at", "updated_at", "deleted_at"]);
  const stringField = fields.find(
    (f) => (f.type === "string" || f.type === "text") && !systemFields.has(f.name) && !f.auto
  );
  return stringField?.name || null;
}
