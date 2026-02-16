import type { Request, Response, NextFunction } from "express";
import type { Registry } from "../metadata/registry.js";
import { AppError } from "../engine/errors.js";
import type { AIProvider } from "./provider.js";
import { buildSystemPrompt } from "./system-prompt.js";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export class AIHandler {
  private provider: AIProvider;
  private registry: Registry;

  constructor(provider: AIProvider, registry: Registry) {
    this.provider = provider;
    this.registry = registry;
  }

  status = asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      data: {
        configured: true,
        model: this.provider.getModel(),
      },
    });
  });

  generate = asyncHandler(async (req: Request, res: Response) => {
    const { prompt } = req.body ?? {};

    if (!prompt || typeof prompt !== "string") {
      throw new AppError("INVALID_PAYLOAD", 400, "prompt is required");
    }

    if (prompt.length > 5000) {
      throw new AppError("INVALID_PAYLOAD", 400, "prompt must be 5000 characters or fewer");
    }

    // Inject existing entity names so AI doesn't duplicate them
    const existingEntities = this.registry.allEntities().map((e) => e.name);
    const systemPrompt = buildSystemPrompt(existingEntities);

    const raw = await this.provider.generate(systemPrompt, prompt);

    // Parse the JSON response
    let schema: Record<string, unknown>;
    try {
      schema = JSON.parse(raw);
    } catch {
      throw new AppError(
        "AI_REQUEST_FAILED",
        502,
        "AI returned invalid JSON. Try rephrasing your prompt.",
      );
    }

    // Ensure version field exists
    if (!schema.version) {
      schema.version = 1;
    }

    res.json({ data: { schema } });
  });
}
