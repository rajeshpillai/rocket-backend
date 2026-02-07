import { get, post } from "./client.js";

export interface SchemaExport {
  version: number;
  exported_at: string;
  entities: any[];
  relations: any[];
  rules: any[];
  state_machines: any[];
  workflows: any[];
  permissions: any[];
  webhooks: any[];
}

export interface ImportResult {
  message: string;
  summary: Record<string, number>;
  errors?: string[];
}

export async function exportSchema(): Promise<SchemaExport> {
  const res = await get<{ data: SchemaExport }>("/_admin/export");
  return res.data;
}

export async function importSchema(data: SchemaExport): Promise<ImportResult> {
  const res = await post<{ data: ImportResult }>("/_admin/import", data);
  return res.data;
}
