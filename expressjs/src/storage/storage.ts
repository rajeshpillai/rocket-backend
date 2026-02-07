/** FileStorage abstracts file persistence. Local-disk today, S3 later. */
export interface FileStorage {
  /** Persist file content, return storage path for retrieval/deletion. */
  save(appName: string, fileID: string, filename: string, buffer: Buffer): Promise<string>;
  /** Read the stored file. */
  open(storagePath: string): Promise<Buffer>;
  /** Remove the file from storage. */
  delete(storagePath: string): Promise<void>;
}
