import { AppError } from "../engine/errors.js";

export class AIProvider {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(baseUrl: string, apiKey: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, ""); // strip trailing slash
    this.apiKey = apiKey;
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;

    const body = {
      model: this.model,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new AppError(
        "AI_REQUEST_FAILED",
        502,
        `Failed to connect to AI provider: ${(err as Error).message}`,
      );
    }

    if (!res.ok) {
      let detail = "";
      try {
        const errBody = await res.json();
        detail = errBody?.error?.message || JSON.stringify(errBody);
      } catch {
        detail = await res.text().catch(() => "");
      }
      throw new AppError(
        "AI_REQUEST_FAILED",
        502,
        `AI provider returned ${res.status}: ${detail}`,
      );
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new AppError(
        "AI_REQUEST_FAILED",
        502,
        "AI provider returned empty response",
      );
    }

    return content;
  }
}

export function createAIProvider(
  baseUrl: string,
  apiKey: string,
  model: string,
): AIProvider | null {
  if (!baseUrl || !apiKey || !model) return null;
  return new AIProvider(baseUrl, apiKey, model);
}
