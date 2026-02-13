import type { Readable } from "node:stream";

/** FileStorage abstracts file persistence. Local-disk today, S3 later. */
export interface FileStorage {
  /** Persist file content, return storage path for retrieval/deletion. */
  save(appName: string, fileID: string, filename: string, buffer: Buffer): Promise<string>;
  /** Open a readable stream for the stored file. */
  openStream(storagePath: string): Readable;
  /** Remove the file from storage. */
  delete(storagePath: string): Promise<void>;
}
