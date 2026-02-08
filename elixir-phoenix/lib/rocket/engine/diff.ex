defmodule Rocket.Engine.Diff do
  @moduledoc "Child write operations: diff/replace/append modes for one-to-many and many-to-many."

  alias Rocket.Store.Postgres
  alias Rocket.Metadata.{Entity, Relation, Registry}
  alias Rocket.Engine.Writer

  def execute_child_write(conn, registry, parent_id, rw) do
    if Relation.many_to_many?(rw.relation) do
      execute_many_to_many_write(conn, registry, parent_id, rw)
    else
      execute_one_to_many_write(conn, registry, parent_id, rw)
    end
  end

  # ── One-to-many ──

  defp execute_one_to_many_write(conn, registry, parent_id, rw) do
    target_entity = Registry.get_entity(registry, rw.relation.target)

    if target_entity == nil do
      {:error, "unknown target entity: #{rw.relation.target}"}
    else
      case rw.write_mode do
        "replace" -> execute_replace_write(conn, target_entity, rw.relation, parent_id, rw.data)
        "append" -> execute_append_write(conn, target_entity, rw.relation, parent_id, rw.data)
        _ -> execute_diff_write(conn, target_entity, rw.relation, parent_id, rw.data)
      end
    end
  end

  defp execute_diff_write(conn, target_entity, rel, parent_id, data) do
    pk_field = target_entity.primary_key.field
    {:ok, existing} = fetch_current_children(conn, target_entity, rel, parent_id)
    existing_by_pk = index_by_pk(existing, pk_field)

    Enum.reduce_while(data, :ok, fn row, :ok ->
      cond do
        # _delete flag
        row["_delete"] == true ->
          pk = row[pk_field]
          if pk, do: soft_delete_child(conn, target_entity, pk)
          {:cont, :ok}

        # Has PK — update if exists
        row[pk_field] != nil ->
          pk = row[pk_field]

          if Map.has_key?(existing_by_pk, to_string(pk)) do
            case update_child(conn, target_entity, pk, row) do
              :ok -> {:cont, :ok}
              err -> {:halt, err}
            end
          else
            {:cont, :ok}
          end

        # No PK — insert
        true ->
          row = Map.put(row, rel.target_key, parent_id)

          case insert_child(conn, target_entity, row) do
            :ok -> {:cont, :ok}
            err -> {:halt, err}
          end
      end
    end)
  end

  defp execute_replace_write(conn, target_entity, rel, parent_id, data) do
    pk_field = target_entity.primary_key.field
    {:ok, existing} = fetch_current_children(conn, target_entity, rel, parent_id)
    existing_by_pk = index_by_pk(existing, pk_field)

    {seen, result} =
      Enum.reduce_while(data, {MapSet.new(), :ok}, fn row, {seen, :ok} ->
        pk = row[pk_field]

        cond do
          pk != nil ->
            pk_str = to_string(pk)

            if Map.has_key?(existing_by_pk, pk_str) do
              case update_child(conn, target_entity, pk, row) do
                :ok -> {:cont, {MapSet.put(seen, pk_str), :ok}}
                err -> {:halt, {seen, err}}
              end
            else
              {:cont, {seen, :ok}}
            end

          true ->
            row = Map.put(row, rel.target_key, parent_id)

            case insert_child(conn, target_entity, row) do
              :ok -> {:cont, {seen, :ok}}
              err -> {:halt, {seen, err}}
            end
        end
      end)

    if result == :ok do
      # Delete existing rows not in incoming
      Enum.each(existing_by_pk, fn {pk_str, row} ->
        unless MapSet.member?(seen, pk_str) do
          soft_delete_child(conn, target_entity, row[pk_field])
        end
      end)

      :ok
    else
      result
    end
  end

  defp execute_append_write(conn, target_entity, rel, parent_id, data) do
    pk_field = target_entity.primary_key.field

    Enum.reduce_while(data, :ok, fn row, :ok ->
      if row[pk_field] != nil do
        {:cont, :ok}
      else
        row = Map.put(row, rel.target_key, parent_id)

        case insert_child(conn, target_entity, row) do
          :ok -> {:cont, :ok}
          err -> {:halt, err}
        end
      end
    end)
  end

  # ── Many-to-many ──

  defp execute_many_to_many_write(conn, registry, parent_id, rw) do
    rel = rw.relation
    target_entity = Registry.get_entity(registry, rel.target)

    if target_entity == nil do
      {:error, "unknown target entity: #{rel.target}"}
    else
      target_pk_field = target_entity.primary_key.field

      case rw.write_mode do
        "replace" ->
          # Delete all, insert all
          Postgres.exec(conn, "DELETE FROM #{rel.join_table} WHERE #{rel.source_join_key} = $1", [parent_id])

          Enum.each(rw.data, fn row ->
            target_id = row[target_pk_field] || row["id"]
            if target_id, do: insert_join_row(conn, rel, parent_id, target_id)
          end)

          :ok

        "append" ->
          Enum.each(rw.data, fn row ->
            target_id = row[target_pk_field] || row["id"]

            if target_id do
              Postgres.exec(
                conn,
                "INSERT INTO #{rel.join_table} (#{rel.source_join_key}, #{rel.target_join_key}) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                [parent_id, target_id]
              )
            end
          end)

          :ok

        _ ->
          # diff mode
          {:ok, current_rows} =
            Postgres.query_rows(
              conn,
              "SELECT #{rel.target_join_key} FROM #{rel.join_table} WHERE #{rel.source_join_key} = $1",
              [parent_id]
            )

          current_targets =
            MapSet.new(current_rows, fn r -> to_string(r[rel.target_join_key]) end)

          Enum.each(rw.data, fn row ->
            target_id = row[target_pk_field] || row["id"]

            if target_id do
              if row["_delete"] == true do
                Postgres.exec(
                  conn,
                  "DELETE FROM #{rel.join_table} WHERE #{rel.source_join_key} = $1 AND #{rel.target_join_key} = $2",
                  [parent_id, target_id]
                )
              else
                unless MapSet.member?(current_targets, to_string(target_id)) do
                  insert_join_row(conn, rel, parent_id, target_id)
                end
              end
            end
          end)

          :ok
      end
    end
  end

  # ── Helpers ──

  defp fetch_current_children(conn, entity, rel, parent_id) do
    columns = Entity.field_names(entity) |> Enum.join(", ")
    sql = "SELECT #{columns} FROM #{entity.table} WHERE #{rel.target_key} = $1"
    sql = if entity.soft_delete, do: sql <> " AND deleted_at IS NULL", else: sql
    Postgres.query_rows(conn, sql, [parent_id])
  end

  defp index_by_pk(rows, pk_field) do
    Map.new(rows, fn row -> {to_string(row[pk_field]), row} end)
  end

  defp insert_child(conn, entity, fields) do
    {sql, params} = Writer.build_insert_sql(entity, fields)

    case Postgres.query_rows(conn, sql, params) do
      {:ok, _} -> :ok
      {:error, err} -> {:error, err}
    end
  end

  defp update_child(conn, entity, id, fields) do
    {sql, params} = Writer.build_update_sql(entity, id, fields)

    if sql == "" do
      :ok
    else
      case Postgres.exec(conn, sql, params) do
        {:ok, _} -> :ok
        {:error, err} -> {:error, err}
      end
    end
  end

  defp soft_delete_child(conn, entity, id) do
    {sql, params} =
      if entity.soft_delete do
        Rocket.Engine.SoftDelete.build_soft_delete_sql(entity, id)
      else
        Rocket.Engine.SoftDelete.build_hard_delete_sql(entity, id)
      end

    case Postgres.exec(conn, sql, params) do
      {:ok, _} -> :ok
      {:error, err} -> {:error, err}
    end
  end

  defp insert_join_row(conn, rel, source_id, target_id) do
    Postgres.exec(
      conn,
      "INSERT INTO #{rel.join_table} (#{rel.source_join_key}, #{rel.target_join_key}) VALUES ($1, $2)",
      [source_id, target_id]
    )
  end
end
