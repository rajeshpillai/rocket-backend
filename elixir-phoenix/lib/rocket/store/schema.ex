defmodule Rocket.Store.Schema do
  @moduledoc "Maps field types to PostgreSQL DDL types."

  def postgres_type(%{type: "string"}), do: "TEXT"
  def postgres_type(%{type: "text"}), do: "TEXT"
  def postgres_type(%{type: t}) when t in ["int", "integer"], do: "INTEGER"
  def postgres_type(%{type: "bigint"}), do: "BIGINT"
  def postgres_type(%{type: "float"}), do: "DOUBLE PRECISION"

  def postgres_type(%{type: "decimal", precision: p}) when is_integer(p) and p > 0,
    do: "NUMERIC(18,#{p})"

  def postgres_type(%{type: "decimal"}), do: "NUMERIC"
  def postgres_type(%{type: "boolean"}), do: "BOOLEAN"
  def postgres_type(%{type: "uuid"}), do: "UUID"
  def postgres_type(%{type: "timestamp"}), do: "TIMESTAMPTZ"
  def postgres_type(%{type: "date"}), do: "DATE"
  def postgres_type(%{type: t}) when t in ["json", "file"], do: "JSONB"
  def postgres_type(_), do: "TEXT"
end
