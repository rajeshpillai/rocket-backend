import { createSignal, onMount, Show, For, type JSX } from "solid-js";
import {
  listPendingInstances,
  getWorkflowInstance,
  approveInstance,
  rejectInstance,
  deleteInstance,
} from "../api/workflows";
import type { WorkflowInstance } from "../types/workflow";
import { isApiError } from "../types/api";
import { DataTable, type Column } from "../components/data-table";
import { Modal } from "../components/modal";
import { Badge } from "../components/badge";
import { ConfirmDialog } from "../components/confirm-dialog";
import { addToast } from "../stores/notifications";

export function WorkflowMonitor() {
  const [instances, setInstances] = createSignal<WorkflowInstance[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [detailOpen, setDetailOpen] = createSignal(false);
  const [selectedInstance, setSelectedInstance] = createSignal<WorkflowInstance | null>(null);
  const [confirmAction, setConfirmAction] = createSignal<{ id: string; action: "approve" | "reject" | "delete" } | null>(null);

  async function loadInstances() {
    setLoading(true);
    try {
      const res = await listPendingInstances();
      setInstances(res.data);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadInstances();
  });

  const openDetail = async (id: string) => {
    try {
      const res = await getWorkflowInstance(id);
      setSelectedInstance(res.data);
      setDetailOpen(true);
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to load instance");
      }
    }
  };

  const handleAction = async () => {
    const ca = confirmAction();
    if (!ca) return;

    try {
      if (ca.action === "approve") {
        await approveInstance(ca.id);
        addToast("success", "Workflow approved");
      } else if (ca.action === "reject") {
        await rejectInstance(ca.id);
        addToast("success", "Workflow rejected");
      } else {
        await deleteInstance(ca.id);
        addToast("success", "Workflow instance deleted");
      }
      setConfirmAction(null);
      setDetailOpen(false);
      await loadInstances();
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", `Failed to ${ca.action} workflow`);
      }
      setConfirmAction(null);
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "running": return "blue";
      case "completed": return "green";
      case "failed": return "red";
      default: return "gray";
    }
  };

  type Row = {
    id: string;
    workflow_name: string;
    status: string;
    current_step: string;
    deadline: string;
    created: string;
  };

  const rows = (): Row[] =>
    instances().map((inst) => ({
      id: inst.id,
      workflow_name: inst.workflow_name,
      status: inst.status,
      current_step: inst.current_step || "-",
      deadline: inst.current_step_deadline
        ? new Date(inst.current_step_deadline).toLocaleString()
        : "-",
      created: inst.created_at
        ? new Date(inst.created_at).toLocaleString()
        : "-",
    }));

  const columns: Column<Row>[] = [
    { key: "workflow_name", header: "Workflow" },
    {
      key: "status",
      header: "Status",
      render: (val): JSX.Element => (
        <Badge label={val} color={statusColor(val)} />
      ),
    },
    { key: "current_step", header: "Current Step" },
    { key: "deadline", header: "Deadline" },
    { key: "created", header: "Created" },
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
              openDetail(row.id);
            }}
          >
            View
          </button>
          <button
            class="btn-primary btn-sm"
            onClick={(e: Event) => {
              e.stopPropagation();
              setConfirmAction({ id: row.id, action: "approve" });
            }}
          >
            Approve
          </button>
          <button
            class="btn-danger btn-sm"
            onClick={(e: Event) => {
              e.stopPropagation();
              setConfirmAction({ id: row.id, action: "reject" });
            }}
          >
            Reject
          </button>
          <button
            class="btn-danger btn-sm"
            onClick={(e: Event) => {
              e.stopPropagation();
              setConfirmAction({ id: row.id, action: "delete" });
            }}
            title="Delete instance"
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
          <h1 class="page-title">Workflow Monitor</h1>
          <p class="page-subtitle">
            View and manage running workflow instances
          </p>
        </div>
        <button class="btn-secondary" onClick={loadInstances}>
          Refresh
        </button>
      </div>

      {loading() ? (
        <p class="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
      ) : (
        <DataTable
          columns={columns}
          rows={rows()}
          emptyMessage="No pending workflow instances."
        />
      )}

      {/* Detail Modal */}
      <Modal
        open={detailOpen()}
        onClose={() => setDetailOpen(false)}
        title={`Instance: ${selectedInstance()?.id?.slice(0, 8) ?? ""}...`}
        wide
      >
        <Show when={selectedInstance()}>
          {(inst) => (
            <div class="flex flex-col gap-3">
              <div class="form-row">
                <div>
                  <span class="text-xs text-gray-500 dark:text-gray-400">Workflow</span>
                  <p class="text-sm font-medium">{inst().workflow_name}</p>
                </div>
                <div>
                  <span class="text-xs text-gray-500 dark:text-gray-400">Status</span>
                  <p>
                    <Badge label={inst().status} color={statusColor(inst().status)} />
                  </p>
                </div>
                <div>
                  <span class="text-xs text-gray-500 dark:text-gray-400">Current Step</span>
                  <p class="text-sm font-medium">{inst().current_step || "-"}</p>
                </div>
              </div>

              <Show when={inst().current_step_deadline}>
                <div>
                  <span class="text-xs text-gray-500 dark:text-gray-400">Deadline</span>
                  <p class="text-sm">
                    {new Date(inst().current_step_deadline!).toLocaleString()}
                  </p>
                </div>
              </Show>

              <div>
                <span class="text-xs text-gray-500 dark:text-gray-400">Context</span>
                <pre class="text-xs bg-gray-50 dark:bg-gray-800/50 p-2 rounded mt-1 overflow-auto" style="max-height: 150px;">
                  {JSON.stringify(inst().context, null, 2)}
                </pre>
              </div>

              <div>
                <span class="text-xs text-gray-500 dark:text-gray-400">History</span>
                <div class="mt-1 flex flex-col gap-1">
                  <For each={inst().history}>
                    {(entry) => (
                      <div class="flex items-center gap-2 text-xs p-1 bg-gray-50 dark:bg-gray-800/50 rounded">
                        <Badge
                          label={entry.status}
                          color={
                            entry.status === "completed" || entry.status === "approved"
                              ? "green"
                              : entry.status === "rejected" || entry.status === "timed_out"
                                ? "red"
                                : "gray"
                          }
                        />
                        <span class="font-medium">{entry.step}</span>
                        <Show when={entry.by}>
                          <span class="text-gray-500 dark:text-gray-400">by {entry.by}</span>
                        </Show>
                        <span class="text-gray-400 dark:text-gray-500 ml-auto">
                          {new Date(entry.at).toLocaleString()}
                        </span>
                      </div>
                    )}
                  </For>
                  <Show when={inst().history.length === 0}>
                    <p class="text-xs text-gray-400 dark:text-gray-500">No history yet</p>
                  </Show>
                </div>
              </div>

              <div class="flex gap-2 mt-2">
                <Show when={inst().status === "running" && inst().current_step}>
                  <button
                    class="btn-primary"
                    onClick={() =>
                      setConfirmAction({ id: inst().id, action: "approve" })
                    }
                  >
                    Approve
                  </button>
                  <button
                    class="btn-danger"
                    onClick={() =>
                      setConfirmAction({ id: inst().id, action: "reject" })
                    }
                  >
                    Reject
                  </button>
                </Show>
                <button
                  class="btn-danger"
                  onClick={() =>
                    setConfirmAction({ id: inst().id, action: "delete" })
                  }
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </Show>
      </Modal>

      <ConfirmDialog
        open={confirmAction() !== null}
        title={`${confirmAction()?.action === "approve" ? "Approve" : confirmAction()?.action === "reject" ? "Reject" : "Delete"} Workflow`}
        message={`Are you sure you want to ${confirmAction()?.action} this workflow instance?`}
        confirmLabel={confirmAction()?.action === "approve" ? "Approve" : confirmAction()?.action === "reject" ? "Reject" : "Delete"}
        confirmVariant={confirmAction()?.action === "approve" ? "primary" : "danger"}
        onConfirm={handleAction}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
