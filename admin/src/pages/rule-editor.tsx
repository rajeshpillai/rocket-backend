import { Show } from "solid-js";
import type { RulePayload, RuleType, RuleHook, FieldOperator } from "../types/rule";
import { RULE_TYPES, RULE_HOOKS, FIELD_OPERATORS } from "../types/rule";
import { TextInput } from "../components/form/text-input";
import { SelectInput } from "../components/form/select-input";
import { Toggle } from "../components/form/toggle";
import { ExpressionBuilder } from "../components/form/expression-builder";
import { useEntities } from "../stores/entities";

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
  const { parsed } = useEntities();

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

  const entityFields = () => {
    const ent = parsed().find((e) => e.name === props.rule.entity);
    return ent?.fields;
  };

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
          <ExpressionBuilder
            value={props.rule.definition.expression ?? ""}
            onChange={(expr) => updateDef({ expression: expr })}
            fields={entityFields()}
            vars={["record", "old", "action"]}
            placeholder="e.g. record.status == 'paid' && record.payment_date == null"
            helpText="Returns true = rule violated"
          />
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
          <ExpressionBuilder
            value={props.rule.definition.expression ?? ""}
            onChange={(expr) => updateDef({ expression: expr })}
            fields={entityFields()}
            vars={["record", "old", "action"]}
            placeholder="e.g. record.subtotal * (1 + record.tax_rate)"
            helpText="Result is set on the target field before write"
          />
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
