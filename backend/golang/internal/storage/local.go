package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// LocalStorage stores files on the local filesystem.
type LocalStorage struct {
	basePath string
}

func NewLocalStorage(basePath string) *LocalStorage {
	return &LocalStorage{basePath: basePath}
}

func (s *LocalStorage) Save(_ context.Context, appName, fileID, filename string, reader io.Reader) (string, error) {
	dir := filepath.Join(s.basePath, appName, fileID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("create dir: %w", err)
	}

	storagePath := filepath.Join(dir, filename)
	f, err := os.Create(storagePath)
	if err != nil {
		return "", fmt.Errorf("create file: %w", err)
	}
	defer f.Close()

	if _, err := io.Copy(f, reader); err != nil {
		return "", fmt.Errorf("write file: %w", err)
	}

	return storagePath, nil
}

func (s *LocalStorage) Open(_ context.Context, storagePath string) (io.ReadCloser, error) {
	f, err := os.Open(storagePath)
	if err != nil {
		return nil, fmt.Errorf("open file: %w", err)
	}
	return f, nil
}

func (s *LocalStorage) Delete(_ context.Context, storagePath string) error {
	if err := os.Remove(storagePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove file: %w", err)
	}
	// Try to remove parent dir (fileID dir) if empty
	dir := filepath.Dir(storagePath)
	_ = os.Remove(dir)
	return nil
}
