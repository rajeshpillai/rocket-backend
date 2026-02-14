defmodule RocketWeb.FileController do
  @moduledoc "File upload, serve, delete, and list endpoints."
  use RocketWeb, :controller

  alias Rocket.Store
  alias Rocket.Storage.Local, as: FileStorage
  alias Rocket.Engine.AppError
  alias Rocket.Instrument.Instrumenter

  # POST /api/:app/_files/upload
  def upload(conn, _params) do
    span = Instrumenter.start_span("engine", "storage", "file.upload")

    try do
      db = get_conn(conn)
      app_name = get_app_name(conn)
      max_size = get_max_file_size()

      case conn.params do
        %{"file" => %Plug.Upload{} = upload} ->
          stat = File.stat!(upload.path)

          if stat.size > max_size do
            _span = Instrumenter.set_status(span, "error")
            respond_error(conn, AppError.new("FILE_TOO_LARGE", 413, "File too large: #{stat.size} bytes (max #{max_size})"))
          else
            file_id = Ecto.UUID.generate()
            filename = upload.filename
            mime_type = upload.content_type || "application/octet-stream"
            size = stat.size

            data = File.read!(upload.path)

            case FileStorage.save(app_name, file_id, filename, data) do
              {:ok, storage_path} ->
                user_id = get_user_id(conn)

                case Store.exec(db,
                       "INSERT INTO _files (id, filename, storage_path, mime_type, size, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6)",
                       [file_id, filename, storage_path, mime_type, size, user_id]) do
                  {:ok, _} ->
                    span = Instrumenter.set_metadata(span, "file_id", file_id)
                    span = Instrumenter.set_metadata(span, "size", size)
                    _span = Instrumenter.set_status(span, "ok")

                    conn
                    |> put_status(201)
                    |> json(%{data: %{
                      id: file_id,
                      filename: filename,
                      size: size,
                      mime_type: mime_type,
                      url: "/api/#{app_name}/_files/#{file_id}"
                    }})

                  {:error, err} ->
                    # Cleanup saved file on DB error
                    FileStorage.delete(storage_path)
                    _span = Instrumenter.set_status(span, "error")
                    respond_error(conn, AppError.new("INTERNAL_ERROR", 500, "#{inspect(err)}"))
                end

              {:error, err} ->
                _span = Instrumenter.set_status(span, "error")
                respond_error(conn, AppError.new("INTERNAL_ERROR", 500, "File save failed: #{inspect(err)}"))
            end
          end

        _ ->
          _span = Instrumenter.set_status(span, "error")
          respond_error(conn, AppError.new("INVALID_PAYLOAD", 400, "Missing file field in multipart upload"))
      end
    after
      Instrumenter.end_span(span)
    end
  end

  # GET /api/:app/_files/:id
  def serve(conn, %{"id" => id}) do
    span = Instrumenter.start_span("engine", "storage", "file.serve")
    span = Instrumenter.set_metadata(span, "file_id", id)

    try do
      db = get_conn(conn)

      case Store.query_row(db,
             "SELECT filename, storage_path, mime_type, size FROM _files WHERE id = $1",
             [id]) do
        {:ok, row} ->
          storage_path = row["storage_path"]
          mime_type = row["mime_type"] || "application/octet-stream"
          filename = row["filename"]
          disk_path = FileStorage.full_path(storage_path)

          if File.exists?(disk_path) do
            _span = Instrumenter.set_status(span, "ok")

            conn
            |> put_resp_content_type(mime_type)
            |> put_resp_header("content-disposition", "inline; filename=\"#{filename}\"")
            |> send_file(200, disk_path)
          else
            _span = Instrumenter.set_status(span, "error")
            respond_error(conn, AppError.not_found("file", id))
          end

        {:error, :not_found} ->
          _span = Instrumenter.set_status(span, "error")
          respond_error(conn, AppError.not_found("file", id))

        {:error, err} ->
          _span = Instrumenter.set_status(span, "error")
          respond_error(conn, AppError.new("INTERNAL_ERROR", 500, "#{inspect(err)}"))
      end
    after
      Instrumenter.end_span(span)
    end
  end

  # DELETE /api/:app/_files/:id
  def delete_file(conn, %{"id" => id}) do
    span = Instrumenter.start_span("engine", "storage", "file.delete")
    span = Instrumenter.set_metadata(span, "file_id", id)

    try do
      db = get_conn(conn)

      case Store.query_row(db,
             "SELECT storage_path FROM _files WHERE id = $1",
             [id]) do
        {:ok, row} ->
          storage_path = row["storage_path"]
          FileStorage.delete(storage_path)
          Store.exec(db, "DELETE FROM _files WHERE id = $1", [id])
          _span = Instrumenter.set_status(span, "ok")
          json(conn, %{data: %{deleted: true}})

        {:error, :not_found} ->
          _span = Instrumenter.set_status(span, "error")
          respond_error(conn, AppError.not_found("file", id))

        {:error, err} ->
          _span = Instrumenter.set_status(span, "error")
          respond_error(conn, AppError.new("INTERNAL_ERROR", 500, "#{inspect(err)}"))
      end
    after
      Instrumenter.end_span(span)
    end
  end

  # GET /api/:app/_files
  def list_files(conn, _params) do
    db = get_conn(conn)

    case Store.query_rows(db,
           "SELECT id, filename, mime_type, size, uploaded_by, created_at FROM _files ORDER BY created_at DESC") do
      {:ok, rows} ->
        json(conn, %{data: rows || []})

      {:error, err} ->
        respond_error(conn, AppError.new("INTERNAL_ERROR", 500, "#{inspect(err)}"))
    end
  end

  # ── Helpers ──

  defp get_conn(conn), do: conn.assigns[:db_conn] || Rocket.Store.mgmt_conn()

  defp get_app_name(conn) do
    case conn.assigns[:app_context] do
      %{name: name} -> name
      _ -> conn.params["app"] || "default"
    end
  end

  defp get_user_id(conn) do
    case conn.assigns[:current_user] do
      %{"id" => id} -> id
      %{id: id} -> id
      _ -> nil
    end
  end

  defp get_max_file_size do
    case Rocket.Config.load() do
      %{storage: %{max_file_size: size}} when is_integer(size) -> size
      _ -> 10_485_760
    end
  end

  defp respond_error(conn, %AppError{} = err) do
    conn
    |> put_status(err.status)
    |> json(%{error: AppError.to_json(err)})
  end
end
