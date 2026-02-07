import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { Store } from "../store/postgres.js";
import type { FileStorage } from "../storage/storage.js";
import { queryRows, queryRow, exec } from "../store/postgres.js";
import { AppError } from "./errors.js";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export class FileHandler {
  private store: Store;
  private storage: FileStorage;
  private maxSize: number;
  private appName: string;

  constructor(store: Store, storage: FileStorage, maxSize: number, appName: string) {
    this.store = store;
    this.storage = storage;
    this.maxSize = maxSize;
    this.appName = appName;
  }

  upload = asyncHandler(async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      throw new AppError("INVALID_PAYLOAD", 400, "Missing file in form data");
    }

    if (file.size > this.maxSize) {
      throw new AppError(
        "FILE_TOO_LARGE",
        413,
        `File too large: ${file.size} bytes (max ${this.maxSize})`,
      );
    }

    const fileID = randomUUID();
    const filename = file.originalname;
    const mimeType = file.mimetype || "application/octet-stream";

    const storagePath = await this.storage.save(this.appName, fileID, filename, file.buffer);

    // Get uploader ID if authenticated
    const uploadedBy = req.user?.id ?? null;

    try {
      await exec(
        this.store.pool,
        `INSERT INTO _files (id, filename, storage_path, mime_type, size, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [fileID, filename, storagePath, mimeType, file.size, uploadedBy],
      );
    } catch (err) {
      // Clean up stored file on DB failure
      await this.storage.delete(storagePath).catch(() => {});
      throw err;
    }

    const url = `/api/${this.appName}/_files/${fileID}`;

    res.status(201).json({
      data: {
        id: fileID,
        filename,
        size: file.size,
        mime_type: mimeType,
        url,
      },
    });
  });

  serve = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;

    let row: Record<string, any>;
    try {
      row = await queryRow(
        this.store.pool,
        "SELECT filename, storage_path, mime_type, size FROM _files WHERE id = $1",
        [id],
      );
    } catch {
      throw new AppError("NOT_FOUND", 404, `File ${id} not found`);
    }

    const buffer = await this.storage.open(row.storage_path);

    res.set("Content-Type", row.mime_type);
    res.set("Content-Disposition", `inline; filename="${row.filename}"`);
    res.send(buffer);
  });

  delete = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;

    let row: Record<string, any>;
    try {
      row = await queryRow(
        this.store.pool,
        "SELECT storage_path FROM _files WHERE id = $1",
        [id],
      );
    } catch {
      throw new AppError("NOT_FOUND", 404, `File ${id} not found`);
    }

    await this.storage.delete(row.storage_path);
    await exec(this.store.pool, "DELETE FROM _files WHERE id = $1", [id]);

    res.json({ data: { deleted: true } });
  });

  list = asyncHandler(async (_req: Request, res: Response) => {
    let rows = await queryRows(
      this.store.pool,
      "SELECT id, filename, mime_type, size, uploaded_by, created_at FROM _files ORDER BY created_at DESC",
    );
    if (!rows) rows = [];
    res.json({ data: rows });
  });
}
