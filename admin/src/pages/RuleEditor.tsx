import { Show } from "solid-js";
import type { RulePayload, RuleType, RuleHook, FieldOperator } from "../types/rule";
import { RULE_TYPES, RULE_HOOKS, FIELD_OPERATORS } from "../types/rule";
import { TextInput } from "../components/form/TextInput";
import { SelectInput } from "../components/form/SelectInput";
import { Toggle } from "../components/form/Toggle";

interface RuleEditorProps {
  rule: RulePayload;
  entityNames: string[];
  onChange: (rule: RulePayload) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}

export function RuleEditor(props: RuleEditorProps) {
  const update = (partial: Partial<RulePayload>) => {
    props.onChange({ ...props.rule, ...partial });
  };

  const updateDef = (partial: Record<string, any>) => {
    props.onChange({
      ...props.rule,
      definition: { ...props.rule.definition, ...partial },
    });
  };

  const isField = () => props.rule.type === "field";
  const isExpression = () => props.rule.type === "expression";
  const isComputed = () => props.rule.type === "computed";

  const entityOptions = () =>
    props.entityNames.map((n) => ({ value: n, label: n }));

  return (
    <div class="flex flex-col gap-4">
      <Show when={props.error}>
        <div class="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {props.error}
        </div>
      </Show>

      <div class="form-row">
        <SelectInput
          label="Entity"
          value={props.rule.entity}
          onChange={(v) => update({ entity: v })}
          options={entityOptions()}
          placeholder="Select entity"
        />
        <SelectInput
          label="Hook"
          value={props.rule.hook}
          onChange={(v) => update({ hook: v as RuleHook })}
          options={RULE_HOOKS.map((h) => ({
            value: h,
            label: h.replace(/_/g, " "),
          }))}
        />
      </div>

      <div class="form-row">
        <SelectInput
          label="Type"
          value={props.rule.type}
          onChange={(v) => update({ type: v as RuleType })}
          options={RULE_TYPES.map((t) => ({ value: t, label: t }))}
        />
        <TextInput
          label="Priority"
          value={String(props.rule.priority)}
          onInput={(v) => update({ priority: parseInt(v, 10) || 0 })}
          type="number"
        />
      </div>

      <Toggle
        label="Active"
        checked={props.rule.active}
        onChange={(v) => update({ active: v })}
      />

      {/* Field rule fields */}
      <Show when={isField()}>
        <div class="form-row">
          <TextInput
            label="Field"
            value={props.rule.definition.field ?? ""}
            onInput={(v) => updateDef({ field: v })}
            placeholder="e.g. total"
          />
          <SelectInput
            label="Operator"
            value={props.rule.definition.operator ?? "min"}
            onChange={(v) => updateDef({ operator: v as FieldOperator })}
            options={FIELD_OPERATORS.map((o) => ({
              value: o,
              label: o.replace(/_/g, " "),
            }))}
          />
        </div>
        <TextInput
          label="Value"
          value={String(props.rule.definition.value ?? "")}
          onInput={(v) => updateDef({ value: v })}
          placeholder="e.g. 0"
        />
      </Show>

      {/* Expression rule fields */}
      <Show when={isExpression()}>
        <div class="form-group">
          <label class="form-label">Expression</label>
          <textarea
            class="form-input"
            rows={3}
            value={props.rule.definition.expression ?? ""}
            onInput={(e) => updateDef({ expression: e.currentTarget.value })}
            placeholder="e.g. record.status == 'paid' && record.payment_date == null"
          />
          <span class="text-xs text-gray-500">
            Returns true = rule violated. Available: record, old, action
          </span>
        </div>
        <Toggle
          label="Stop on fail"
          checked={props.rule.definition.stop_on_fail ?? false}
          onChange={(v) => updateDef({ stop_on_fail: v })}
        />
      </Show>

      {/* Computed field fields */}
      <Show when={isComputed()}>
        <TextInput
          label="Target Field"
          value={props.rule.definition.field ?? ""}
          onInput={(v) => updateDef({ field: v })}
          placeholder="e.g. total"
        />
        <div class="form-group">
          <label class="form-label">Expression</label>
          <textarea
            class="form-input"
            rows={3}
            value={props.rule.definition.expression ?? ""}
            onInput={(e) => updateDef({ expression: e.currentTarget.value })}
            placeholder="e.g. record.subtotal * (1 + record.tax_rate)"
          />
          <span class="text-xs text-gray-500">
            Result is set on the target field before write
          </span>
        </div>
      </Show>

      {/* Message (for field and expression rules) */}
      <Show when={isField() || isExpression()}>
        <TextInput
          label="Message"
          value={props.rule.definition.message ?? ""}
          onInput={(v) => updateDef({ message: v })}
          placeholder="Custom error message"
        />
      </Show>

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
