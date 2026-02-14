defmodule Rocket.Engine.SoftDelete do
  @moduledoc "Soft/hard delete SQL builders and cascade handling."

  alias Rocket.Store
  alias Rocket.Metadata.{Relation, Registry}
  alias Rocket.Engine.AppError

  def build_soft_delete_sql(entity, id) do
    {"UPDATE #{entity.table} SET deleted_at = NOW() WHERE #{entity.primary_key.field} = $1 AND deleted_at IS NULL",
     [id]}
  end

  def build_hard_delete_sql(entity, id) do
    {"DELETE FROM #{entity.table} WHERE #{entity.primary_key.field} = $1", [id]}
  end

  @doc "Process on_delete cascade policies for all relations where entity is the source."
  def handle_cascade_delete(conn, registry, entity, record_id) do
    relations = Registry.get_relations_for_source(registry, entity.name)

    Enum.reduce_while(relations, :ok, fn rel, :ok ->
      case execute_cascade(conn, registry, rel, record_id) do
        :ok -> {:cont, :ok}
        {:error, _} = err -> {:halt, err}
      end
    end)
  end

  defp execute_cascade(conn, registry, rel, parent_id) do
    case rel.on_delete do
      "cascade" ->
        cascade_delete(conn, registry, rel, parent_id)

      "set_null" ->
        target_entity = Registry.get_entity(registry, rel.target)

        if target_entity do
          Store.exec(
            conn,
            "UPDATE #{target_entity.table} SET #{rel.target_key} = NULL WHERE #{rel.target_key} = $1",
            [parent_id]
          )

          :ok
        else
          :ok
        end

      "restrict" ->
        target_entity = Registry.get_entity(registry, rel.target)

        if target_entity do
          count_sql = "SELECT COUNT(*) as count FROM #{target_entity.table} WHERE #{rel.target_key} = $1"

          count_sql =
            if target_entity.soft_delete,
              do: count_sql <> " AND deleted_at IS NULL",
              else: count_sql

          case Store.query_row(conn, count_sql, [parent_id]) do
            {:ok, %{"count" => count}} when count > 0 ->
              {:error,
               AppError.conflict(
                 "Cannot delete: #{count} related #{rel.target} records exist"
               )}

            _ ->
              :ok
          end
        else
          :ok
        end

      "detach" ->
        if Relation.many_to_many?(rel) do
          Store.exec(
            conn,
            "DELETE FROM #{rel.join_table} WHERE #{rel.source_join_key} = $1",
            [parent_id]
          )

          :ok
        else
          :ok
        end

      _ ->
        :ok
    end
  end

  defp cascade_delete(conn, registry, rel, parent_id) do
    if Relation.many_to_many?(rel) do
      Store.exec(
        conn,
        "DELETE FROM #{rel.join_table} WHERE #{rel.source_join_key} = $1",
        [parent_id]
      )

      :ok
    else
      target_entity = Registry.get_entity(registry, rel.target)

      if target_entity do
        if target_entity.soft_delete do
          Store.exec(
            conn,
            "UPDATE #{target_entity.table} SET deleted_at = NOW() WHERE #{rel.target_key} = $1 AND deleted_at IS NULL",
            [parent_id]
          )
        else
          Store.exec(
            conn,
            "DELETE FROM #{target_entity.table} WHERE #{rel.target_key} = $1",
            [parent_id]
          )
        end

        :ok
      else
        :ok
      end
    end
  end
end
