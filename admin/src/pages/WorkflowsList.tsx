import { createSignal, onMount, type JSX } from "solid-js";
import {
  listWorkflows,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
} from "../api/workflows";
import {
  parseWorkflowRow,
  emptyWorkflow,
  type WorkflowRow,
  type WorkflowPayload,
} from "../types/workflow";
import { isApiError } from "../types/api";
import { useEntities } from "../stores/entities";
import { DataTable, type Column } from "../components/DataTable";
import { Modal } from "../components/Modal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Badge } from "../components/Badge";
import { WorkflowEditor } from "./WorkflowEditor";
import { addToast } from "../stores/notifications";

export function WorkflowsList() {
  const { entityNames, load: loadEntities } = useEntities();
  const [workflows, setWorkflows] = createSignal<WorkflowRow[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingWF, setEditingWF] = createSignal<WorkflowPayload>(emptyWorkflow());
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [editorError, setEditorError] = createSignal<string | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<string | null>(null);

  async function loadWorkflowList() {
    setLoading(true);
    try {
      const res = await listWorkflows();
      setWorkflows(res.data);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadWorkflowList();
    loadEntities();
  });

  type Row = {
    id: string;
    name: string;
    trigger_entity: string;
    trigger_field: string;
    trigger_to: string;
    steps_count: number;
    active: boolean;
    _payload: WorkflowPayload;
  };

  const rows = (): Row[] =>
    workflows().map((row) => {
      const wf = parseWorkflowRow(row);
      return {
        id: row.id,
        name: wf.name,
        trigger_entity: wf.trigger.entity ?? "",
        trigger_field: wf.trigger.field ?? "",
        trigger_to: wf.trigger.to ?? "",
        steps_count: wf.steps.length,
        active: wf.active,
        _payload: wf,
      };
    });

  const openCreate = () => {
    setEditingWF(emptyWorkflow());
    setEditingId(null);
    setEditorError(null);
    setEditorOpen(true);
  };

  const openEdit = (payload: WorkflowPayload) => {
    setEditingWF(JSON.parse(JSON.stringify(payload)));
    setEditingId(payload.id ?? null);
    setEditorError(null);
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const wf = editingWF();
    if (!wf.name) {
      setEditorError("Name is required");
      return;
    }
    if (!wf.trigger.entity) {
      setEditorError("Trigger entity is required");
      return;
    }

    setSaving(true);
    setEditorError(null);

    try {
      if (editingId()) {
        await updateWorkflow(editingId()!, wf);
        addToast("success", "Workflow updated");
      } else {
        await createWorkflow(wf);
        addToast("success", "Workflow created");
      }
      setEditorOpen(false);
      await loadWorkflowList();
    } catch (err) {
      if (isApiError(err)) {
        setEditorError(err.error.message);
      } else {
        setEditorError("Failed to save workflow");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const id = deleteTarget();
    if (!id) return;
    try {
      await deleteWorkflow(id);
      addToast("success", "Workflow deleted");
      setDeleteTarget(null);
      await loadWorkflowList();
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to delete workflow");
      }
      setDeleteTarget(null);
    }
  };

  const columns: Column<Row>[] = [
    { key: "name", header: "Name" },
    { key: "trigger_entity", header: "Trigger Entity" },
    { key: "trigger_field", header: "Field" },
    { key: "trigger_to", header: "To State" },
    { key: "steps_count", header: "Steps" },
    {
      key: "active",
      header: "Active",
      render: (val): JSX.Element => (
        <Badge label={val ? "yes" : "no"} color={val ? "green" : "gray"} />
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
          <h1 class="page-title">Workflows</h1>
          <p class="page-subtitle">
            Manage multi-step workflow definitions
          </p>
        </div>
        <button class="btn-primary" onClick={openCreate}>
          Create Workflow
        </button>
      </div>

      {loading() ? (
        <p class="text-sm text-gray-500">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={rows()}
          emptyMessage="No workflows yet. Create one to define multi-step processes."
        />
      )}

      <Modal
        open={editorOpen()}
        onClose={() => setEditorOpen(false)}
        title={editingId() ? "Edit Workflow" : "Create Workflow"}
        wide
      >
        <WorkflowEditor
          wf={editingWF()}
          entityNames={entityNames()}
          onChange={setEditingWF}
          onSave={handleSave}
          onCancel={() => setEditorOpen(false)}
          saving={saving()}
          error={editorError()}
        />
      </Modal>

      <ConfirmDialog
        open={deleteTarget() !== null}
        title="Delete Workflow"
        message="Are you sure you want to delete this workflow? Running instances will be orphaned."
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
