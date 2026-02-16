defmodule Rocket.Storage.Local do
  @moduledoc "Local disk file storage implementation."
  @behaviour Rocket.Storage.Behaviour

  @default_base_path "uploads"

  def base_path do
    Application.get_env(:rocket, :storage_base_path, @default_base_path)
  end

  @impl true
  def save(app_name, file_id, filename, data) do
    dir = Path.join([base_path(), app_name, file_id])
    File.mkdir_p!(dir)

    path = Path.join(dir, filename)
    storage_path = Path.join([app_name, file_id, filename])

    case File.write(path, data) do
      :ok -> {:ok, storage_path}
      {:error, reason} -> {:error, reason}
    end
  end

  @impl true
  def open(storage_path) do
    path = Path.join(base_path(), storage_path)
    File.read(path)
  end

  @impl true
  def full_path(storage_path) do
    Path.join(base_path(), storage_path)
  end

  @impl true
  def delete(storage_path) do
    path = Path.join(base_path(), storage_path)
    File.rm(path)

    # Try to remove parent directory (file_id dir) if empty
    dir = Path.dirname(path)

    case File.ls(dir) do
      {:ok, []} -> File.rmdir(dir)
      _ -> :ok
    end

    :ok
  end
end
