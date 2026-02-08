defmodule Rocket.Engine.Writer do
  @moduledoc "SQL builders for INSERT/UPDATE and field validation."

  alias Rocket.Metadata.{Entity, Relation, Registry}

  defmodule RelationWrite do
    defstruct [:relation, :write_mode, data: []]
  end

  @doc "Build parameterized INSERT SQL. Returns {sql, params}."
  def build_insert_sql(entity, fields) do
    {cols, vals, params, _n} =
      entity.fields
      |> Enum.reduce({[], [], [], 0}, fn f, {cols, vals, params, n} ->
        cond do
          f.name == entity.primary_key.field && entity.primary_key.generated ->
            {cols, vals, params, n}

          f.auto in ["create", "update"] ->
            {cols, vals, params, n}

          f.name == "deleted_at" ->
            {cols, vals, params, n}

          true ->
            val = Map.get(fields, f.name)

            cond do
              val != nil ->
                n = n + 1
                {cols ++ [f.name], vals ++ ["$#{n}"], params ++ [val], n}

              f.default != nil ->
                n = n + 1
                {cols ++ [f.name], vals ++ ["$#{n}"], params ++ [f.default], n}

              true ->
                {cols, vals, params, n}
            end
        end
      end)

    # Add auto-timestamp fields
    {cols, vals} =
      Enum.reduce(entity.fields, {cols, vals}, fn f, {cols, vals} ->
        if f.auto in ["create", "update"] do
          {cols ++ [f.name], vals ++ ["NOW()"]}
        else
          {cols, vals}
        end
      end)

    sql =
      "INSERT INTO #{entity.table} (#{Enum.join(cols, ", ")}) VALUES (#{Enum.join(vals, ", ")}) RETURNING #{entity.primary_key.field}"

    {sql, params}
  end

  @doc "Build parameterized UPDATE SQL. Returns {sql, params} or {\"\", []} if nothing to update."
  def build_update_sql(entity, id, fields) do
    updatable = Entity.updatable_fields(entity)

    {sets, params, n} =
      Enum.reduce(updatable, {[], [], 0}, fn f, {sets, params, n} ->
        case Map.fetch(fields, f.name) do
          {:ok, val} ->
            n = n + 1
            {sets ++ ["#{f.name} = $#{n}"], params ++ [val], n}

          :error ->
            {sets, params, n}
        end
      end)

    # Auto-update timestamp
    sets =
      Enum.reduce(entity.fields, sets, fn f, sets ->
        if f.auto == "update" do
          sets ++ ["#{f.name} = NOW()"]
        else
          sets
        end
      end)

    if sets == [] do
      {"", []}
    else
      n = n + 1
      params = params ++ [id]
      where = "#{entity.primary_key.field} = $#{n}"

      where =
        if entity.soft_delete do
          where <> " AND deleted_at IS NULL"
        else
          where
        end

      sql = "UPDATE #{entity.table} SET #{Enum.join(sets, ", ")} WHERE #{where}"
      {sql, params}
    end
  end

  @doc "Validate incoming fields against entity metadata."
  def validate_fields(entity, fields, is_create) do
    errs = []

    # Check for unknown fields
    errs =
      Enum.reduce(Map.keys(fields), errs, fn key, errs ->
        if Entity.has_field?(entity, key) do
          errs
        else
          errs ++ [%{field: key, rule: "unknown", message: "Unknown field: #{key}"}]
        end
      end)

    # Check required fields on create
    errs =
      if is_create do
        Enum.reduce(Entity.writable_fields(entity), errs, fn f, errs ->
          if f.required && !f.nullable do
            val = Map.get(fields, f.name)

            if val == nil || val == "" do
              errs ++ [%{field: f.name, rule: "required", message: "#{f.name} is required"}]
            else
              errs
            end
          else
            errs
          end
        end)
      else
        errs
      end

    # Check enum constraints
    errs =
      Enum.reduce(entity.fields, errs, fn f, errs ->
        if f.enum != nil && f.enum != [] do
          val = Map.get(fields, f.name)

          if val != nil do
            str_val = to_string(val)

            if str_val in f.enum do
              errs
            else
              errs ++
                [
                  %{
                    field: f.name,
                    rule: "enum",
                    message: "#{f.name} must be one of: #{Enum.join(f.enum, ", ")}"
                  }
                ]
            end
          else
            errs
          end
        else
          errs
        end
      end)

    errs
  end

  @doc "Split request body into entity fields and relation writes."
  def separate_fields_and_relations(entity, registry, body) do
    Enum.reduce(body, {%{}, %{}, []}, fn {key, val}, {fields, rel_writes, unknown} ->
      cond do
        Entity.has_field?(entity, key) ->
          {Map.put(fields, key, val), rel_writes, unknown}

        true ->
          rel = Registry.find_relation_for_entity(registry, key, entity.name)

          if rel != nil && rel.source == entity.name do
            case parse_relation_write(rel, val) do
              {:ok, rw} ->
                {fields, Map.put(rel_writes, key, rw), unknown}

              :error ->
                {fields, rel_writes, unknown ++ [key]}
            end
          else
            {fields, rel_writes, unknown ++ [key]}
          end
      end
    end)
  end

  defp parse_relation_write(rel, val) when is_map(val) do
    write_mode = Map.get(val, "_write_mode", Relation.default_write_mode(rel))

    case Map.get(val, "data") do
      data when is_list(data) ->
        items = Enum.filter(data, &is_map/1)

        {:ok,
         %RelationWrite{
           relation: rel,
           write_mode: write_mode,
           data: items
         }}

      _ ->
        :error
    end
  end

  defp parse_relation_write(_, _), do: :error
end
