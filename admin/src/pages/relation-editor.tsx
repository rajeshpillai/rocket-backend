import { Show } from "solid-js";
import type { RelationDefinition, RelationType, Ownership, OnDelete, FetchStrategy, WriteMode } from "../types/relation";
import { RELATION_TYPES, OWNERSHIP_OPTIONS, ON_DELETE_OPTIONS, FETCH_OPTIONS, WRITE_MODE_OPTIONS } from "../types/relation";
import { TextInput } from "../components/form/text-input";
import { SelectInput } from "../components/form/select-input";

interface RelationEditorProps {
  relation: RelationDefinition;
  entityNames: string[];
  onChange: (relation: RelationDefinition) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}

export function RelationEditor(props: RelationEditorProps) {
  const update = (partial: Partial<RelationDefinition>) => {
    props.onChange({ ...props.relation, ...partial });
  };

  const isManyToMany = () => props.relation.type === "many_to_many";

  const entityOptions = () =>
    props.entityNames.map((n) => ({ value: n, label: n }));

  return (
    <div class="flex flex-col gap-4">
      <Show when={props.error}>
        <div class="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {props.error}
        </div>
      </Show>

      <TextInput
        label="Name"
        value={props.relation.name}
        onInput={(v) => update({ name: v })}
        placeholder="e.g. items"
      />

      <SelectInput
        label="Type"
        value={props.relation.type}
        onChange={(v) => update({ type: v as RelationType })}
        options={RELATION_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))}
      />

      <div class="form-row">
        <SelectInput
          label="Source Entity"
          value={props.relation.source}
          onChange={(v) => update({ source: v })}
          options={entityOptions()}
          placeholder="Select source"
        />
        <SelectInput
          label="Target Entity"
          value={props.relation.target}
          onChange={(v) => update({ target: v })}
          options={entityOptions()}
          placeholder="Select target"
        />
      </div>

      <div class="form-row">
        <TextInput
          label="Source Key"
          value={props.relation.source_key}
          onInput={(v) => update({ source_key: v })}
          placeholder="e.g. id"
        />
        <Show when={!isManyToMany()}>
          <TextInput
            label="Target Key"
            value={props.relation.target_key ?? ""}
            onInput={(v) => update({ target_key: v })}
            placeholder="e.g. invoice_id"
          />
        </Show>
      </div>

      <Show when={isManyToMany()}>
        <TextInput
          label="Join Table"
          value={props.relation.join_table ?? ""}
          onInput={(v) => update({ join_table: v })}
          placeholder="e.g. product_categories"
        />
        <div class="form-row">
          <TextInput
            label="Source Join Key"
            value={props.relation.source_join_key ?? ""}
            onInput={(v) => update({ source_join_key: v })}
            placeholder="e.g. product_id"
          />
          <TextInput
            label="Target Join Key"
            value={props.relation.target_join_key ?? ""}
            onInput={(v) => update({ target_join_key: v })}
            placeholder="e.g. category_id"
          />
        </div>
      </Show>

      <div class="form-row">
        <SelectInput
          label="Ownership"
          value={props.relation.ownership}
          onChange={(v) => update({ ownership: v as Ownership })}
          options={OWNERSHIP_OPTIONS.map((o) => ({ value: o, label: o }))}
        />
        <SelectInput
          label="On Delete"
          value={props.relation.on_delete}
          onChange={(v) => update({ on_delete: v as OnDelete })}
          options={ON_DELETE_OPTIONS.map((o) => ({
            value: o,
            label: o.replace(/_/g, " "),
          }))}
        />
      </div>

      <div class="form-row">
        <SelectInput
          label="Fetch Strategy"
          value={props.relation.fetch ?? "lazy"}
          onChange={(v) => update({ fetch: v as FetchStrategy })}
          options={FETCH_OPTIONS.map((o) => ({ value: o, label: o }))}
        />
        <SelectInput
          label="Write Mode"
          value={props.relation.write_mode ?? "diff"}
          onChange={(v) => update({ write_mode: v as WriteMode })}
          options={WRITE_MODE_OPTIONS.map((o) => ({ value: o, label: o }))}
        />
      </div>

      <div class="modal-footer" style="padding: 0; border: none; margin-top: 0.5rem;">
        <button class="btn-secondary" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          class="btn-primary"
          onClick={props.onSave}
          disabled={props.saving}
        >
          {props.saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
