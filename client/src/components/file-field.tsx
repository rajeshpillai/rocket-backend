import { createSignal, Show } from "solid-js";
import { uploadFile, fileUrl, type FileMetadata } from "../api/data";
import { getSelectedApp } from "../stores/app";

interface FileFieldProps {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  required?: boolean;
  error?: string;
}

export default function FileField(props: FileFieldProps) {
  const [uploading, setUploading] = createSignal(false);
  const [uploadError, setUploadError] = createSignal("");

  function getMetadata(): FileMetadata | null {
    if (!props.value) return null;
    if (typeof props.value === "string") {
      try {
        return JSON.parse(props.value) as FileMetadata;
      } catch {
        return null;
      }
    }
    if (typeof props.value === "object" && "id" in (props.value as Record<string, unknown>)) {
      return props.value as FileMetadata;
    }
    return null;
  }

  async function handleUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError("");

    try {
      const meta = await uploadFile(file);
      props.onChange(meta.id);
    } catch {
      setUploadError("Upload failed");
    } finally {
      setUploading(false);
      input.value = "";
    }
  }

  function handleRemove() {
    props.onChange(null);
  }

  const meta = () => getMetadata();

  return (
    <div class="form-group">
      <label class={props.required ? "form-label form-label-required" : "form-label"}>
        {props.label}
      </label>

      <Show
        when={meta()}
        fallback={
          <div>
            <input
              type="file"
              class="form-input"
              onChange={handleUpload}
              disabled={uploading()}
              style={{ padding: "6px" }}
            />
            <Show when={uploading()}>
              <span class="form-help-text">Uploading...</span>
            </Show>
          </div>
        }
      >
        {(m) => (
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "8px",
              padding: "8px 12px",
              "background-color": "#f9fafb",
              "border-radius": "8px",
              border: "1px solid #e5e7eb",
            }}
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              style={{ width: "16px", height: "16px", color: "#6b7280", "flex-shrink": "0" }}
            >
              <path
                fill-rule="evenodd"
                d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                clip-rule="evenodd"
              />
            </svg>
            <div style={{ flex: "1", "min-width": "0" }}>
              <div style={{ "font-size": "13px", "font-weight": "500", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
                {m().filename}
              </div>
              <div style={{ "font-size": "11px", color: "#9ca3af" }}>
                {formatFileSize(m().size)}
              </div>
            </div>
            <a
              href={fileUrl(getSelectedApp() || "", m().id)}
              target="_blank"
              rel="noopener"
              class="btn-ghost btn-sm"
              style={{ "font-size": "12px" }}
            >
              Download
            </a>
            <button
              class="btn-ghost btn-sm"
              style={{ "font-size": "12px", color: "#ef4444" }}
              onClick={handleRemove}
            >
              Remove
            </button>
          </div>
        )}
      </Show>

      <Show when={uploadError()}>
        <span class="form-error-text">{uploadError()}</span>
      </Show>
      <Show when={props.error}>
        <span class="form-error-text">{props.error}</span>
      </Show>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
