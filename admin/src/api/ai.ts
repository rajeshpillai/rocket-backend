import { get, post } from "./client.js";

export interface AIStatus {
  configured: boolean;
  model: string;
}

export async function getAIStatus(): Promise<AIStatus> {
  const res = await get<{ data: AIStatus }>("/_admin/ai/status");
  return res.data;
}

export async function generateSchema(
  prompt: string,
): Promise<Record<string, any>> {
  const res = await post<{ data: { schema: Record<string, any> } }>(
    "/_admin/ai/generate",
    { prompt },
  );
  return res.data.schema;
}
