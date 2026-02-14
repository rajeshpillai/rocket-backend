import { isApiError } from "../types/api";

export interface BatchResult {
  id: string;
  success: boolean;
  error?: string;
}

/**
 * Execute an operation on multiple IDs in parallel batches.
 * Returns per-ID success/failure results.
 */
export async function batchExecute(
  ids: string[],
  operation: (id: string) => Promise<void>,
  concurrency: number = 5,
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];

  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async (id): Promise<BatchResult> => {
        try {
          await operation(id);
          return { id, success: true };
        } catch (err) {
          const msg = isApiError(err) ? err.error.message : "Unknown error";
          return { id, success: false, error: msg };
        }
      }),
    );

    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      }
    }
  }

  return results;
}

/** Generate a CSV string from field names and record data. */
export function generateCsv(
  fields: string[],
  records: Record<string, unknown>[],
): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const str = typeof value === "object" ? JSON.stringify(value) : String(value);
    if (str.includes(",") || str.includes("\n") || str.includes('"')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const header = fields.map(escape).join(",");
  const rows = records.map((rec) => fields.map((f) => escape(rec[f])).join(","));
  return [header, ...rows].join("\n");
}

/** Trigger a file download in the browser. */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string = "text/csv",
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
