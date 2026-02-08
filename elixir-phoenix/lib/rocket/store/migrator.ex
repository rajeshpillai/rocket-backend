defmodule Rocket.Store.Migrator do
  @moduledoc "Dynamic CREATE TABLE / ALTER TABLE based on entity metadata."

  alias Rocket.Store.{Postgres, Schema}

  def migrate(conn, entity) do
    case table_exists?(conn, entity.table) do
      true -> alter_table(conn, entity)
      false -> create_table(conn, entity)
    end
  end

  def migrate_join_table(conn, rel, source_entity, target_entity) do
    if table_exists?(conn, rel.join_table) do
      :ok
    else
      source_field = find_field(source_entity, rel.source_key)
      target_field = find_field(target_entity, target_entity.primary_key.field)

      if source_field && target_field do
        sql = """
        CREATE TABLE #{rel.join_table} (
          #{rel.source_join_key} #{Schema.postgres_type(source_field)} NOT NULL,
          #{rel.target_join_key} #{Schema.postgres_type(target_field)} NOT NULL,
          PRIMARY KEY (#{rel.source_join_key}, #{rel.target_join_key})
        )
        """

        Postgres.exec!(conn, sql)
      else
        {:error, "cannot resolve key types for join table #{rel.join_table}"}
      end
    end
  end

  defp create_table(conn, entity) do
    cols =
      Enum.map(entity.fields, fn f ->
        build_column_def(entity, f)
      end)

    cols =
      if entity.soft_delete && !has_field?(entity, "deleted_at") do
        cols ++ ["deleted_at TIMESTAMPTZ"]
      else
        cols
      end

    sql = "CREATE TABLE #{entity.table} (\n  #{Enum.join(cols, ",\n  ")}\n)"
    Postgres.exec!(conn, sql)
    create_indexes(conn, entity)
  end

  defp alter_table(conn, entity) do
    existing = get_columns(conn, entity.table)

    Enum.each(entity.fields, fn f ->
      unless Map.has_key?(existing, f.name) do
        col_type = Schema.postgres_type(f)

        not_null =
          if f.required && !f.nullable do
            " NOT NULL DEFAULT ''"
          else
            ""
          end

        Postgres.exec!(conn, "ALTER TABLE #{entity.table} ADD COLUMN #{f.name} #{col_type}#{not_null}")
      end
    end)

    if entity.soft_delete && !Map.has_key?(existing, "deleted_at") do
      Postgres.exec!(conn, "ALTER TABLE #{entity.table} ADD COLUMN deleted_at TIMESTAMPTZ")
    end

    create_indexes(conn, entity)
  end

  defp build_column_def(entity, f) do
    col = "#{f.name} #{Schema.postgres_type(f)}"

    col =
      if f.name == entity.primary_key.field do
        pk = col <> " PRIMARY KEY"

        if entity.primary_key.generated && entity.primary_key.type == "uuid" do
          pk <> " DEFAULT gen_random_uuid()"
        else
          pk
        end
      else
        col
      end

    col =
      if f.required && !f.nullable && f.name != entity.primary_key.field do
        col <> " NOT NULL"
      else
        col
      end

    col =
      if f.default != nil && f.name != entity.primary_key.field do
        case f.default do
          v when is_binary(v) -> col <> " DEFAULT '#{v}'"
          v when is_number(v) -> col <> " DEFAULT #{v}"
          v when is_boolean(v) -> col <> " DEFAULT #{v}"
          v -> col <> " DEFAULT '#{v}'"
        end
      else
        col
      end

    col
  end

  defp create_indexes(conn, entity) do
    Enum.each(entity.fields, fn f ->
      if f.unique do
        Postgres.exec!(
          conn,
          "CREATE UNIQUE INDEX IF NOT EXISTS idx_#{entity.table}_#{f.name} ON #{entity.table} (#{f.name})"
        )
      end
    end)

    if entity.soft_delete do
      Postgres.exec!(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_#{entity.table}_deleted_at ON #{entity.table} (deleted_at) WHERE deleted_at IS NULL"
      )
    end

    :ok
  end

  defp table_exists?(conn, table_name) do
    case Postgres.query_row(
           conn,
           "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public') as exists",
           [table_name]
         ) do
      {:ok, %{"exists" => true}} -> true
      _ -> false
    end
  end

  defp get_columns(conn, table_name) do
    case Postgres.query_rows(
           conn,
           "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'",
           [table_name]
         ) do
      {:ok, rows} ->
        Map.new(rows, fn r -> {r["column_name"], r["data_type"]} end)

      _ ->
        %{}
    end
  end

  defp find_field(entity, name) do
    Enum.find(entity.fields, &(&1.name == name))
  end

  defp has_field?(entity, name) do
    Enum.any?(entity.fields, &(&1.name == name))
  end
end
