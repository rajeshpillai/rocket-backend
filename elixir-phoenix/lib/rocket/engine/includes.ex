defmodule Rocket.Engine.Includes do
  @moduledoc "Loads related data and attaches to parent rows using separate queries."

  alias Rocket.Store.Postgres
  alias Rocket.Metadata.{Entity, Relation, Registry}

  def load_includes(_conn, _registry, _entity, rows, _includes) when rows == [], do: {:ok, rows}
  def load_includes(_conn, _registry, _entity, rows, []), do: {:ok, rows}

  def load_includes(conn, registry, entity, rows, includes) do
    Enum.reduce_while(includes, {:ok, rows}, fn inc_name, {:ok, rows} ->
      rel = Registry.find_relation_for_entity(registry, inc_name, entity.name)

      if rel == nil do
        {:cont, {:ok, rows}}
      else
        result =
          cond do
            rel.source == entity.name ->
              load_forward_relation(conn, registry, entity, rel, rows, inc_name)

            rel.target == entity.name ->
              load_reverse_relation(conn, registry, entity, rel, rows, inc_name)

            true ->
              {:ok, rows}
          end

        case result do
          {:ok, rows} -> {:cont, {:ok, rows}}
          {:error, _} = err -> {:halt, err}
        end
      end
    end)
  end

  defp load_forward_relation(conn, registry, parent_entity, rel, rows, inc_name) do
    parent_pk = parent_entity.primary_key.field
    parent_ids = collect_values(rows, parent_pk)

    if parent_ids == [] do
      {:ok, rows}
    else
      if Relation.many_to_many?(rel) do
        load_many_to_many(conn, registry, rel, rows, parent_pk, parent_ids, inc_name)
      else
        load_one_to_x(conn, registry, rel, rows, parent_pk, parent_ids, inc_name)
      end
    end
  end

  defp load_one_to_x(conn, registry, rel, rows, parent_pk, parent_ids, inc_name) do
    target_entity = Registry.get_entity(registry, rel.target)

    if target_entity == nil do
      {:ok, rows}
    else
      columns = target_entity |> Entity.field_names() |> Enum.join(", ")
      sql = "SELECT #{columns} FROM #{target_entity.table} WHERE #{rel.target_key} = ANY($1)"
      sql = if target_entity.soft_delete, do: sql <> " AND deleted_at IS NULL", else: sql

      case Postgres.query_rows(conn, sql, [parent_ids]) do
        {:ok, child_rows} ->
          grouped =
            Enum.group_by(child_rows, fn child -> to_string(child[rel.target_key]) end)

          rows =
            Enum.map(rows, fn row ->
              pk = to_string(row[parent_pk])

              if Relation.one_to_one?(rel) do
                children = Map.get(grouped, pk, [])
                Map.put(row, inc_name, if(children != [], do: hd(children), else: nil))
              else
                Map.put(row, inc_name, Map.get(grouped, pk, []))
              end
            end)

          {:ok, rows}

        {:error, _} = err ->
          err
      end
    end
  end

  defp load_many_to_many(conn, registry, rel, rows, parent_pk, parent_ids, inc_name) do
    target_entity = Registry.get_entity(registry, rel.target)

    if target_entity == nil do
      {:ok, rows}
    else
      # Query join table
      join_sql =
        "SELECT #{rel.source_join_key}, #{rel.target_join_key} FROM #{rel.join_table} WHERE #{rel.source_join_key} = ANY($1)"

      case Postgres.query_rows(conn, join_sql, [parent_ids]) do
        {:ok, join_rows} when join_rows == [] ->
          rows = Enum.map(rows, fn row -> Map.put(row, inc_name, []) end)
          {:ok, rows}

        {:ok, join_rows} ->
          # Collect unique target IDs
          target_ids =
            join_rows
            |> Enum.map(fn jr -> jr[rel.target_join_key] end)
            |> Enum.uniq()

          # Query targets
          columns = target_entity |> Entity.field_names() |> Enum.join(", ")
          target_sql = "SELECT #{columns} FROM #{target_entity.table} WHERE #{target_entity.primary_key.field} = ANY($1)"
          target_sql = if target_entity.soft_delete, do: target_sql <> " AND deleted_at IS NULL", else: target_sql

          case Postgres.query_rows(conn, target_sql, [target_ids]) do
            {:ok, target_rows} ->
              # Index targets by PK
              target_by_pk =
                Map.new(target_rows, fn tr ->
                  {to_string(tr[target_entity.primary_key.field]), tr}
                end)

              # Build source -> [target] mapping
              source_to_targets =
                Enum.reduce(join_rows, %{}, fn jr, acc ->
                  sid = to_string(jr[rel.source_join_key])
                  tid = to_string(jr[rel.target_join_key])

                  case Map.get(target_by_pk, tid) do
                    nil -> acc
                    target -> Map.update(acc, sid, [target], &(&1 ++ [target]))
                  end
                end)

              rows =
                Enum.map(rows, fn row ->
                  pk = to_string(row[parent_pk])
                  Map.put(row, inc_name, Map.get(source_to_targets, pk, []))
                end)

              {:ok, rows}

            {:error, _} = err ->
              err
          end

        {:error, _} = err ->
          err
      end
    end
  end

  defp load_reverse_relation(conn, registry, _entity, rel, rows, inc_name) do
    source_entity = Registry.get_entity(registry, rel.source)

    if source_entity == nil do
      {:ok, rows}
    else
      fk_values = collect_values(rows, rel.target_key)

      if fk_values == [] do
        {:ok, rows}
      else
        columns = source_entity |> Entity.field_names() |> Enum.join(", ")
        sql = "SELECT #{columns} FROM #{source_entity.table} WHERE #{rel.source_key} = ANY($1)"
        sql = if source_entity.soft_delete, do: sql <> " AND deleted_at IS NULL", else: sql

        case Postgres.query_rows(conn, sql, [fk_values]) do
          {:ok, parent_rows} ->
            parent_by_pk =
              Map.new(parent_rows, fn pr ->
                {to_string(pr[rel.source_key]), pr}
              end)

            rows =
              Enum.map(rows, fn row ->
                fk = to_string(row[rel.target_key])
                Map.put(row, inc_name, Map.get(parent_by_pk, fk))
              end)

            {:ok, rows}

          {:error, _} = err ->
            err
        end
      end
    end
  end

  defp collect_values(rows, field) do
    rows
    |> Enum.map(fn row -> row[field] end)
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end
end
