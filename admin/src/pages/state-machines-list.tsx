import { createSignal, onMount, type JSX } from "solid-js";
import {
  listStateMachines,
  createStateMachine,
  updateStateMachine,
  deleteStateMachine,
} from "../api/state-machines";
import {
  parseDefinition,
  emptyStateMachine,
  formatFrom,
  type StateMachineRow,
  type StateMachinePayload,
} from "../types/state-machine";
import { isApiError } from "../types/api";
import { useEntities } from "../stores/entities";
import { DataTable, type Column } from "../components/data-table";
import { Modal } from "../components/modal";
import { ConfirmDialog } from "../components/confirm-dialog";
import { Badge } from "../components/badge";
import { StateMachineEditor } from "./state-machine-editor";
import { addToast } from "../stores/notifications";

export function StateMachinesList() {
  const { entityNames, load: loadEntities } = useEntities();
  const [machines, setMachines] = createSignal<StateMachineRow[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingSM, setEditingSM] = createSignal<StateMachinePayload>(
    emptyStateMachine(),
  );
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [editorError, setEditorError] = createSignal<string | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<string | null>(null);

  async function loadMachines() {
    setLoading(true);
    try {
      const res = await listStateMachines();
      setMachines(res.data);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadMachines();
    loadEntities();
  });

  type Row = {
    id: string;
    entity: string;
    field: string;
    initial: string;
    transitions: string;
    active: boolean;
    _payload: StateMachinePayload;
  };

  const rows = (): Row[] =>
    machines().map((row) => {
      const def = parseDefinition(row);
      const transitionSummary = (def.transitions ?? [])
        .map((t) => `${formatFrom(t.from)} -> ${t.to}`)
        .join(", ");

      return {
        id: row.id,
        entity: row.entity,
        field: row.field,
        initial: def.initial ?? "",
        transitions:
          transitionSummary.length > 60
            ? transitionSummary.slice(0, 60) + "..."
            : transitionSummary,
        active: row.active,
        _payload: {
          id: row.id,
          entity: row.entity,
          field: row.field,
          definition: def,
          active: row.active,
        },
      };
    });

  const openCreate = () => {
    setEditingSM(emptyStateMachine());
    setEditingId(null);
    setEditorError(null);
    setEditorOpen(true);
  };

  const openEdit = (payload: StateMachinePayload) => {
    setEditingSM({
      ...payload,
      definition: {
        ...payload.definition,
        transitions: payload.definition.transitions.map((t) => ({
          ...t,
          actions: [...(t.actions ?? [])],
        })),
      },
    });
    setEditingId(payload.id ?? null);
    setEditorError(null);
    setEditorOpen(true);
  };

  const handleSave = async () => {
    const sm = editingSM();
    if (!sm.entity) {
      setEditorError("Entity is required");
      return;
    }
    if (!sm.field) {
      setEditorError("State field is required");
      return;
    }

    setSaving(true);
    setEditorError(null);

    try {
      if (editingId()) {
        await updateStateMachine(editingId()!, sm);
        addToast("success", "State machine updated");
      } else {
        await createStateMachine(sm);
        addToast("success", "State machine created");
      }
      setEditorOpen(false);
      await loadMachines();
    } catch (err) {
      if (isApiError(err)) {
        setEditorError(err.error.message);
      } else {
        setEditorError("Failed to save state machine");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const id = deleteTarget();
    if (!id) return;
    try {
      await deleteStateMachine(id);
      addToast("success", "State machine deleted");
      setDeleteTarget(null);
      await loadMachines();
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to delete state machine");
      }
      setDeleteTarget(null);
    }
  };

  const columns: Column<Row>[] = [
    { key: "entity", header: "Entity" },
    { key: "field", header: "Field" },
    { key: "initial", header: "Initial State" },
    { key: "transitions", header: "Transitions" },
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
          <h1 class="page-title">State Machines</h1>
          <p class="page-subtitle">
            Manage state transitions, guards, and actions
          </p>
        </div>
        <button class="btn-primary" onClick={openCreate}>
          Create State Machine
        </button>
      </div>

      {loading() ? (
        <p class="text-sm text-gray-500">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={rows()}
          emptyMessage="No state machines yet. Create one to define state transitions."
        />
      )}

      <Modal
        open={editorOpen()}
        onClose={() => setEditorOpen(false)}
        title={editingId() ? "Edit State Machine" : "Create State Machine"}
        wide
      >
        <StateMachineEditor
          sm={editingSM()}
          entityNames={entityNames()}
          onChange={setEditingSM}
          onSave={handleSave}
          onCancel={() => setEditorOpen(false)}
          saving={saving()}
          error={editorError()}
        />
      </Modal>

      <ConfirmDialog
        open={deleteTarget() !== null}
        title="Delete State Machine"
        message="Are you sure you want to delete this state machine?"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
