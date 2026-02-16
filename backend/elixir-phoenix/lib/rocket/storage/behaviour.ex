defmodule Rocket.Storage.Behaviour do
  @moduledoc "File storage behaviour — abstraction for local disk, S3, etc."

  @callback save(app_name :: String.t(), file_id :: String.t(), filename :: String.t(), data :: binary()) ::
              {:ok, storage_path :: String.t()} | {:error, term()}

  @callback open(storage_path :: String.t()) ::
              {:ok, binary()} | {:error, term()}

  @callback full_path(storage_path :: String.t()) :: String.t()

  @callback delete(storage_path :: String.t()) ::
              :ok | {:error, term()}
end
