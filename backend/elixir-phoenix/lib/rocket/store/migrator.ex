defmodule Rocket.Store.Migrator do
  @moduledoc "Dynamic CREATE TABLE / ALTER TABLE based on entity metadata."

  alias Rocket.Store

  def migrate(conn, entity) do
    dialect = Store.dialect()

    case dialect.table_exists?(conn, entity.table) do
      true -> alter_table(conn, entity, dialect)
      false -> create_table(conn, entity, dialect)
    end
  end

  def migrate_join_table(conn, rel, source_entity, target_entity) do
    dialect = Store.dialect()

    if dialect.table_exists?(conn, rel.join_table) do
      :ok
    else
      source_field = find_field(source_entity, rel.source_key)
      target_field = find_field(target_entity, target_entity.primary_key.field)

      if source_field && target_field do
        sql = """
        CREATE TABLE #{rel.join_table} (
          #{rel.source_join_key} #{dialect.column_type(source_field.type, source_field.precision)} NOT NULL,
          #{rel.target_join_key} #{dialect.column_type(target_field.type, target_field.precision)} NOT NULL,
          PRIMARY KEY (#{rel.source_join_key}, #{rel.target_join_key})
        )
        """

        Store.exec!(conn, sql)
      else
        {:error, "cannot resolve key types for join table #{rel.join_table}"}
      end
    end
  end

  defp create_table(conn, entity, dialect) do
    cols =
      Enum.map(entity.fields, fn f ->
        build_column_def(entity, f, dialect)
      end)

    cols =
      if entity.soft_delete && !has_field?(entity, "deleted_at") do
        cols ++ ["deleted_at #{dialect.column_type("timestamp", nil)}"]
      else
        cols
      end

    sql = "CREATE TABLE #{entity.table} (\n  #{Enum.join(cols, ",\n  ")}\n)"
    Store.exec!(conn, sql)
    create_indexes(conn, entity, dialect)
  end

  defp alter_table(conn, entity, dialect) do
    existing = dialect.get_columns(conn, entity.table)

    Enum.each(entity.fields, fn f ->
      unless Map.has_key?(existing, f.name) do
        col_type = dialect.column_type(f.type, f.precision)

        not_null =
          if f.required && !f.nullable do
            " NOT NULL DEFAULT ''"
          else
            ""
          end

        Store.exec!(
          conn,
          "ALTER TABLE #{entity.table} ADD COLUMN #{f.name} #{col_type}#{not_null}"
        )
      end
    end)

    if entity.soft_delete && !Map.has_key?(existing, "deleted_at") do
      Store.exec!(
        conn,
        "ALTER TABLE #{entity.table} ADD COLUMN deleted_at #{dialect.column_type("timestamp", nil)}"
      )
    end

    create_indexes(conn, entity, dialect)
  end

  defp build_column_def(entity, f, dialect) do
    col = "#{f.name} #{dialect.column_type(f.type, f.precision)}"

    col =
      if f.name == entity.primary_key.field do
        pk = col <> " PRIMARY KEY"
        uuid_def = dialect.uuid_default()

        if entity.primary_key.generated && entity.primary_key.type == "uuid" && uuid_def != "" do
          pk <> " " <> uuid_def
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

  defp create_indexes(conn, entity, dialect) do
    Enum.each(entity.fields, fn f ->
      if f.unique do
        Store.exec!(
          conn,
          "CREATE UNIQUE INDEX IF NOT EXISTS idx_#{entity.table}_#{f.name} ON #{entity.table} (#{f.name})"
        )
      end
    end)

    if entity.soft_delete do
      Store.exec!(conn, dialect.soft_delete_index_sql(entity.table))
    end

    :ok
  end

  defp find_field(entity, name) do
    Enum.find(entity.fields, &(&1.name == name))
  end

  defp has_field?(entity, name) do
    Enum.any?(entity.fields, &(&1.name == name))
  end
end
