import { createSignal, onMount, type JSX } from "solid-js";
import { listRules, createRule, updateRule, deleteRule } from "../api/rules";
import { parseRuleDefinition, emptyRule, type RuleRow, type RulePayload } from "../types/rule";
import { isApiError } from "../types/api";
import { useEntities } from "../stores/entities";
import { DataTable, type Column } from "../components/data-table";
import { Modal } from "../components/modal";
import { ConfirmDialog } from "../components/confirm-dialog";
import { Badge } from "../components/badge";
import { RuleEditor } from "./rule-editor";
import { addToast } from "../stores/notifications";

const typeColor: Record<string, "blue" | "purple" | "green"> = {
  field: "blue",
  expression: "purple",
  computed: "green",
};

const hookColor: Record<string, "blue" | "gray"> = {
  before_write: "blue",
  before_delete: "gray",
};

export function RulesList() {
  const { entityNames, load: loadEntities } = useEntities();
  const [rules, setRules] = createSignal<RuleRow[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingRule, setEditingRule] = createSignal<RulePayload>(emptyRule());
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [editorError, setEditorError] = createSignal<string | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<string | null>(null);

  async function loadRules() {
    setLoading(true);
    try {
      const res = await listRules();
      setRules(res.data);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadRules();
    loadEntities();
  });

  type Row = {
    id: string;
    entity: string;
    type: string;
    hook: string;
    priority: number;
    active: boolean;
    summary: string;
    _payload: RulePayload;
  };

  const rows = (): Row[] =>
    rules().map((row) => {
      const def = parseRuleDefinition(row);
      let summary = "";
      if (row.type === "field") {
        summary = `${def.field} ${def.operator} ${def.value ?? ""}`;
      } else if (row.type === "expression") {
        const expr = def.expression ?? "";
        summary = expr.length > 50 ? expr.slice(0, 50) + "..." : expr;
      } else if (row.type === "computed") {
        summary = `${def.field} = ${(def.expression ?? "").slice(0, 40)}`;
      }

      return {
        id: row.id,
        entity: row.entity,
        type: row.type,
        hook: row.hook,
        priority: row.priority,
        active: row.active,
        summary,
        _payload: {
          id: row.id,
          entity: row.entity,
          hook: row.hook as any,
          type: row.type as any,
          definition: def,
          priority: row.priority,
          active: row.active,
        },
      };
    });

  const openCreate = () => {
    setEditingRule(emptyRule());
    setEditingId(null);
    setEditorError(null);
    setEditorOpen(true);
  };

  const openEdit = (payload: RulePayload) => {
    setEditingRule({ ...payload, definition: { ...payload.definition } });
    setEditingId(payload.id ?? null);
    setEditorError(null);
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const rule = editingRule();
    if (!rule.entity) {
      setEditorError("Entity is required");
      return;
    }

    setSaving(true);
    setEditorError(null);

    try {
      if (editingId()) {
        await updateRule(editingId()!, rule);
        addToast("success", "Rule updated");
      } else {
        await createRule(rule);
        addToast("success", "Rule created");
      }
      setEditorOpen(false);
      await loadRules();
    } catch (err) {
      if (isApiError(err)) {
        setEditorError(err.error.message);
      } else {
        setEditorError("Failed to save rule");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const id = deleteTarget();
    if (!id) return;
    try {
      await deleteRule(id);
      addToast("success", "Rule deleted");
      setDeleteTarget(null);
      await loadRules();
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to delete rule");
      }
      setDeleteTarget(null);
    }
  };

  const columns: Column<Row>[] = [
    { key: "entity", header: "Entity" },
    {
      key: "type",
      header: "Type",
      render: (val): JSX.Element => (
        <Badge
          label={String(val)}
          color={typeColor[String(val)] ?? "gray"}
        />
      ),
    },
    {
      key: "hook",
      header: "Hook",
      render: (val): JSX.Element => (
        <Badge
          label={String(val).replace(/_/g, " ")}
          color={hookColor[String(val)] ?? "gray"}
        />
      ),
    },
    { key: "summary", header: "Summary" },
    { key: "priority", header: "Priority" },
    {
      key: "active",
      header: "Active",
      render: (val): JSX.Element => (
        <Badge
          label={val ? "yes" : "no"}
          color={val ? "green" : "gray"}
        />
      ),
    },
    {
      key: "_actions",
      header: "",
      class: "table-cell-actions",
      render: (_, row): JSX.Element => (
        <div class="flex items-center justify-end gap-2">
          <button
            class="btn-secondary btn-sm"
            onClick={(e: Event) => {
              e.stopPropagation();
              openEdit(row._payload);
            }}
          >
            Edit
          </button>
          <button
            class="btn-danger btn-sm"
            onClick={(e: Event) => {
              e.stopPropagation();
              setDeleteTarget(row.id);
            }}
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">Rules</h1>
          <p class="page-subtitle">Manage validation rules and computed fields</p>
        </div>
        <button class="btn-primary" onClick={openCreate}>
          Create Rule
        </button>
      </div>

      {loading() ? (
        <p class="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={rows()}
          emptyMessage="No rules yet. Create one to add validation or computed fields."
        />
      )}

      <Modal
        open={editorOpen()}
        onClose={() => setEditorOpen(false)}
        title={editingId() ? "Edit Rule" : "Create Rule"}
        wide
      >
        <RuleEditor
          rule={editingRule()}
          entityNames={entityNames()}
          onChange={setEditingRule}
          onSave={handleSave}
          onCancel={() => setEditorOpen(false)}
          saving={saving()}
          error={editorError()}
        />
      </Modal>

      <ConfirmDialog
        open={deleteTarget() !== null}
        title="Delete Rule"
        message="Are you sure you want to delete this rule?"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
