import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FileStorage } from "./storage.js";

/** Local filesystem storage implementation. */
export class LocalStorage implements FileStorage {
  constructor(private basePath: string) {}

  async save(appName: string, fileID: string, filename: string, buffer: Buffer): Promise<string> {
    const dir = path.join(this.basePath, appName, fileID);
    await fsp.mkdir(dir, { recursive: true });

    const storagePath = path.join(dir, filename);
    await fsp.writeFile(storagePath, buffer);
    return storagePath;
  }

  async open(storagePath: string): Promise<Buffer> {
    return fsp.readFile(storagePath);
  }

  async delete(storagePath: string): Promise<void> {
    try {
      await fsp.unlink(storagePath);
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
    }
    // Try to remove parent dir (fileID dir) if empty
    const dir = path.dirname(storagePath);
    try {
      await fsp.rmdir(dir);
    } catch {
      // ignore — dir not empty or already gone
    }
  }
}
