package storage

import (
	"context"
	"io"
)

// FileStorage abstracts file persistence. Local-disk today, S3 later.
type FileStorage interface {
	// Save persists file content and returns the storage path (used for retrieval/deletion).
	Save(ctx context.Context, appName, fileID, filename string, reader io.Reader) (storagePath string, err error)
	// Open returns a reader for the stored file.
	Open(ctx context.Context, storagePath string) (io.ReadCloser, error)
	// Delete removes the file from storage.
	Delete(ctx context.Context, storagePath string) error
}
