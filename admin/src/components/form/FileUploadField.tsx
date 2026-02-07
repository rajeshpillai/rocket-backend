import { createSignal, Show } from "solid-js";
import { upload } from "../../api/client";

interface FileMetadata {
  id: string;
  filename: string;
  size: number;
  mime_type: string;
  url: string;
}

interface FileUploadFieldProps {
  label: string;
  value: string; // JSON string of FileMetadata, UUID, or empty
  onChange: (fileId: string) => void;
  required?: boolean;
}

export function FileUploadField(props: FileUploadFieldProps) {
  const [uploading, setUploading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const fileMeta = (): FileMetadata | null => {
    if (!props.value) return null;
    try {
      const parsed = JSON.parse(props.value);
      if (parsed && typeof parsed === "object" && parsed.id) return parsed;
    } catch {
      // might be just a UUID
    }
    return null;
  };

  const handleFileChange = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    setError(null);
    setUploading(true);

    try {
      const resp = await upload<{ data: FileMetadata }>("/_files/upload", file);
      props.onChange(resp.data.id);
    } catch (err: any) {
      const msg = err?.error?.message || "Upload failed";
      setError(msg);
    } finally {
      setUploading(false);
      input.value = "";
    }
  };

  return (
    <div>
      <Show when={fileMeta()}>
        {(meta) => (
          <div class="flex items-center gap-2 mb-2 p-2 bg-gray-50 border rounded text-sm">
            <span class="font-medium">{meta().filename}</span>
            <span class="text-gray-400">
              ({Math.round(meta().size / 1024)} KB)
            </span>
            <button
              type="button"
              class="ml-auto text-red-500 hover:text-red-700 text-xs"
              onClick={() => props.onChange("")}
            >
              Remove
            </button>
          </div>
        )}
      </Show>

      <Show when={!fileMeta()}>
        <Show when={props.value && !fileMeta()}>
          <div class="text-xs text-gray-500 mb-1">File ID: {props.value}</div>
        </Show>
      </Show>

      <input
        type="file"
        class="form-input"
        onChange={handleFileChange}
        disabled={uploading()}
      />

      <Show when={uploading()}>
        <div class="text-sm text-blue-600 mt-1">Uploading...</div>
      </Show>

      <Show when={error()}>
        <div class="text-sm text-red-600 mt-1">{error()}</div>
      </Show>
    </div>
  );
}
