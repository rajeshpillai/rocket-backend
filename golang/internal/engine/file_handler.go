package engine

import (
	"fmt"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"rocket-backend/internal/instrument"
	"rocket-backend/internal/storage"
	"rocket-backend/internal/store"
)

type FileHandler struct {
	store   *store.Store
	storage storage.FileStorage
	maxSize int64
	appName string
}

func NewFileHandler(s *store.Store, fs storage.FileStorage, maxSize int64, appName string) *FileHandler {
	return &FileHandler{store: s, storage: fs, maxSize: maxSize, appName: appName}
}

func (h *FileHandler) Upload(c *fiber.Ctx) error {
	ctx := c.UserContext()
	ctx, span := instrument.GetInstrumenter(ctx).StartSpan(ctx, "storage", "file", "file.upload")
	defer span.End()
	c.SetUserContext(ctx)

	file, err := c.FormFile("file")
	if err != nil {
		span.SetStatus("error")
		return respondError(c, NewAppError("INVALID_PAYLOAD", 400, "Missing file in form data"))
	}

	span.SetMetadata("filename", file.Filename)
	span.SetMetadata("size", file.Size)

	if file.Size > h.maxSize {
		msg := fmt.Sprintf("File too large: %d bytes (max %d)", file.Size, h.maxSize)
		span.SetStatus("error")
		span.SetMetadata("error", msg)
		return respondError(c, NewAppError("FILE_TOO_LARGE", 413, msg))
	}

	src, err := file.Open()
	if err != nil {
		span.SetStatus("error")
		span.SetMetadata("error", err.Error())
		return fmt.Errorf("open uploaded file: %w", err)
	}
	defer src.Close()

	fileID := uuid.New().String()
	filename := file.Filename
	mimeType := file.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	storagePath, err := h.storage.Save(c.Context(), h.appName, fileID, filename, src)
	if err != nil {
		span.SetStatus("error")
		span.SetMetadata("error", err.Error())
		return fmt.Errorf("save file: %w", err)
	}

	// Get uploader ID if authenticated
	var uploadedBy *string
	user := getUser(c)
	if user != nil {
		uploadedBy = &user.ID
	}

	pb := h.store.Dialect.NewParamBuilder()
	insertSQL := fmt.Sprintf(`INSERT INTO _files (id, filename, storage_path, mime_type, size, uploaded_by)
	        VALUES (%s, %s, %s, %s, %s, %s)`,
		pb.Add(fileID), pb.Add(filename), pb.Add(storagePath), pb.Add(mimeType), pb.Add(file.Size), pb.Add(uploadedBy))
	_, err = store.Exec(c.Context(), h.store.DB, insertSQL, pb.Params()...)
	if err != nil {
		// Clean up stored file on DB failure
		_ = h.storage.Delete(c.Context(), storagePath)
		span.SetStatus("error")
		span.SetMetadata("error", err.Error())
		return fmt.Errorf("insert _files: %w", err)
	}

	url := fmt.Sprintf("/api/%s/_files/%s", h.appName, fileID)

	span.SetStatus("ok")
	span.SetMetadata("file_id", fileID)
	return c.Status(201).JSON(fiber.Map{
		"data": fiber.Map{
			"id":        fileID,
			"filename":  filename,
			"size":      file.Size,
			"mime_type": mimeType,
			"url":       url,
		},
	})
}

func (h *FileHandler) Serve(c *fiber.Ctx) error {
	ctx := c.UserContext()
	ctx, span := instrument.GetInstrumenter(ctx).StartSpan(ctx, "storage", "file", "file.serve")
	defer span.End()
	c.SetUserContext(ctx)

	id := c.Params("id")
	span.SetMetadata("file_id", id)

	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT filename, storage_path, mime_type, size FROM _files WHERE id = %s", pb.Add(id)), pb.Params()...)
	if err != nil {
		span.SetStatus("error")
		return respondError(c, NewAppError("NOT_FOUND", 404, fmt.Sprintf("File %s not found", id)))
	}

	storagePath := row["storage_path"].(string)
	mimeType := row["mime_type"].(string)
	filename := row["filename"].(string)

	reader, err := h.storage.Open(c.Context(), storagePath)
	if err != nil {
		span.SetStatus("error")
		span.SetMetadata("error", err.Error())
		return fmt.Errorf("open stored file: %w", err)
	}
	defer reader.Close()

	c.Set("Content-Type", mimeType)
	c.Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, filename))

	span.SetStatus("ok")
	return c.SendStream(reader)
}

func (h *FileHandler) Delete(c *fiber.Ctx) error {
	ctx := c.UserContext()
	ctx, span := instrument.GetInstrumenter(ctx).StartSpan(ctx, "storage", "file", "file.delete")
	defer span.End()
	c.SetUserContext(ctx)

	id := c.Params("id")
	span.SetMetadata("file_id", id)

	pb := h.store.Dialect.NewParamBuilder()
	row, err := store.QueryRow(c.Context(), h.store.DB,
		fmt.Sprintf("SELECT storage_path FROM _files WHERE id = %s", pb.Add(id)), pb.Params()...)
	if err != nil {
		span.SetStatus("error")
		return respondError(c, NewAppError("NOT_FOUND", 404, fmt.Sprintf("File %s not found", id)))
	}

	storagePath := row["storage_path"].(string)

	if err := h.storage.Delete(c.Context(), storagePath); err != nil {
		span.SetStatus("error")
		span.SetMetadata("error", err.Error())
		return fmt.Errorf("delete stored file: %w", err)
	}

	pb2 := h.store.Dialect.NewParamBuilder()
	_, err = store.Exec(c.Context(), h.store.DB,
		fmt.Sprintf("DELETE FROM _files WHERE id = %s", pb2.Add(id)), pb2.Params()...)
	if err != nil {
		span.SetStatus("error")
		span.SetMetadata("error", err.Error())
		return fmt.Errorf("delete _files row: %w", err)
	}

	span.SetStatus("ok")
	return c.JSON(fiber.Map{"data": fiber.Map{"deleted": true}})
}

func (h *FileHandler) List(c *fiber.Ctx) error {
	rows, err := store.QueryRows(c.Context(), h.store.DB,
		"SELECT id, filename, mime_type, size, uploaded_by, created_at FROM _files ORDER BY created_at DESC")
	if err != nil {
		return fmt.Errorf("list _files: %w", err)
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	return c.JSON(fiber.Map{"data": rows})
}
