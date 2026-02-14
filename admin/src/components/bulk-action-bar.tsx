interface BulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDelete: () => void;
  onUpdate: () => void;
  onExport: () => void;
  loading?: boolean;
}

export function BulkActionBar(props: BulkActionBarProps) {
  return (
    <div class="bulk-action-bar">
      <div class="bulk-action-bar-left">
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
          {props.selectedCount} selected
        </span>
        <button class="btn-ghost btn-sm" onClick={props.onSelectAll}>
          Select All ({props.totalCount})
        </button>
        <button class="btn-ghost btn-sm" onClick={props.onDeselectAll}>
          Deselect All
        </button>
      </div>
      <div class="bulk-action-bar-right">
        <button
          class="btn-secondary btn-sm"
          onClick={props.onExport}
          disabled={props.loading}
        >
          Export Selected
        </button>
        <button
          class="btn-secondary btn-sm"
          onClick={props.onUpdate}
          disabled={props.loading}
        >
          Update Selected
        </button>
        <button
          class="btn-danger btn-sm"
          onClick={props.onDelete}
          disabled={props.loading}
        >
          Delete Selected
        </button>
      </div>
    </div>
  );
}
