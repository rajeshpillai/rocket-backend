defmodule Rocket.Engine.Query do
  @moduledoc "Builds parameterized SELECT/COUNT queries from query params."

  alias Rocket.Metadata.{Entity, Registry}

  defmodule QueryPlan do
    defstruct [:entity, filters: [], sorts: [], page: 1, per_page: 25, includes: []]
  end

  defmodule WhereClause do
    defstruct [:field, :operator, :value]
  end

  defmodule OrderClause do
    defstruct [:field, :dir]
  end

  defmodule QueryResult do
    defstruct [:sql, :params]
  end

  @doc "Parse Phoenix conn params into a QueryPlan."
  def parse_query_params(params, entity, registry) do
    plan = %QueryPlan{entity: entity, page: 1, per_page: 25}

    with {:ok, plan} <- parse_filters(plan, params, entity),
         {:ok, plan} <- parse_sorts(plan, params, entity),
         {:ok, plan} <- parse_pagination(plan, params),
         {:ok, plan} <- parse_includes(plan, params, entity, registry) do
      {:ok, plan}
    end
  end

  defp parse_filters(plan, params, entity) do
    filters =
      params
      |> Enum.filter(fn {key, _} -> String.starts_with?(key, "filter[") && String.ends_with?(key, "]") end)
      |> Enum.reduce_while([], fn {key, val}, acc ->
        inner = key |> String.slice(7..-2//1)
        {field, op} = parse_filter_key(inner)

        if Entity.has_field?(entity, field) do
          f = Entity.get_field(entity, field)

          case coerce_value(f, val, op) do
            {:ok, coerced} ->
              {:cont, [%WhereClause{field: field, operator: op, value: coerced} | acc]}

            {:error, msg} ->
              {:halt, {:error, Rocket.Engine.AppError.invalid_payload("Invalid filter value for #{field}: #{msg}")}}
          end
        else
          {:halt, {:error, Rocket.Engine.AppError.unknown_field("Unknown filter field: #{field}")}}
        end
      end)

    case filters do
      {:error, _} = err -> err
      list -> {:ok, %{plan | filters: Enum.reverse(list)}}
    end
  end

  defp parse_sorts(plan, params, entity) do
    case Map.get(params, "sort", "") do
      "" ->
        {:ok, plan}

      sort_param ->
        sorts =
          sort_param
          |> String.split(",")
          |> Enum.reduce_while([], fn part, acc ->
            part = String.trim(part)
            {dir, field} = if String.starts_with?(part, "-"), do: {"DESC", String.slice(part, 1..-1//1)}, else: {"ASC", part}

            if Entity.has_field?(entity, field) do
              {:cont, [%OrderClause{field: field, dir: dir} | acc]}
            else
              {:halt, {:error, Rocket.Engine.AppError.unknown_field("Unknown sort field: #{field}")}}
            end
          end)

        case sorts do
          {:error, _} = err -> err
          list -> {:ok, %{plan | sorts: Enum.reverse(list)}}
        end
    end
  end

  defp parse_pagination(plan, params) do
    page =
      case params["page"] do
        nil -> 1
        p -> max(parse_int(p, 1), 1)
      end

    per_page =
      case params["per_page"] do
        nil -> 25
        pp -> min(max(parse_int(pp, 25), 1), 100)
      end

    {:ok, %{plan | page: page, per_page: per_page}}
  end

  defp parse_includes(plan, params, entity, registry) do
    case Map.get(params, "include", "") do
      "" ->
        {:ok, plan}

      inc ->
        includes =
          inc
          |> String.split(",")
          |> Enum.reduce_while([], fn name, acc ->
            name = String.trim(name)
            rel = Registry.find_relation_for_entity(registry, name, entity.name)

            if rel do
              {:cont, [name | acc]}
            else
              {:halt, {:error, Rocket.Engine.AppError.unknown_field("Unknown include: #{name}")}}
            end
          end)

        case includes do
          {:error, _} = err -> err
          list -> {:ok, %{plan | includes: Enum.reverse(list)}}
        end
    end
  end

  @doc "Build parameterized SELECT SQL."
  def build_select_sql(%QueryPlan{} = plan) do
    {params, n} = {[], 0}
    entity = plan.entity

    columns = entity |> Entity.field_names() |> Enum.join(", ")

    columns =
      if entity.soft_delete && !Entity.has_field?(entity, "deleted_at") do
        columns <> ", deleted_at"
      else
        columns
      end

    {where, params, n} = build_where_clauses(plan, params, n)

    sql = "SELECT #{columns} FROM #{entity.table}"
    sql = if where != "", do: sql <> " WHERE " <> where, else: sql

    # Sort
    sql =
      if plan.sorts != [] do
        order_parts = Enum.map(plan.sorts, fn s -> "#{s.field} #{s.dir}" end)
        sql <> " ORDER BY " <> Enum.join(order_parts, ", ")
      else
        sql
      end

    # Pagination
    n = n + 1
    params = params ++ [plan.per_page]
    limit_ph = "$#{n}"
    n = n + 1
    params = params ++ [(plan.page - 1) * plan.per_page]
    offset_ph = "$#{n}"
    sql = sql <> " LIMIT #{limit_ph} OFFSET #{offset_ph}"

    %QueryResult{sql: sql, params: params}
  end

  @doc "Build parameterized COUNT SQL."
  def build_count_sql(%QueryPlan{} = plan) do
    {where, params, _n} = build_where_clauses(plan, [], 0)

    sql = "SELECT COUNT(*) as count FROM #{plan.entity.table}"
    sql = if where != "", do: sql <> " WHERE " <> where, else: sql

    %QueryResult{sql: sql, params: params}
  end

  defp build_where_clauses(plan, params, n) do
    entity = plan.entity

    {clauses, params, n} =
      if entity.soft_delete do
        {["deleted_at IS NULL"], params, n}
      else
        {[], params, n}
      end

    {clauses, params, n} =
      Enum.reduce(plan.filters, {clauses, params, n}, fn f, {cls, prms, idx} ->
        {clause, prms, idx} = build_where_clause(f, prms, idx)
        {cls ++ [clause], prms, idx}
      end)

    where = Enum.join(clauses, " AND ")
    {where, params, n}
  end

  defp build_where_clause(%WhereClause{operator: "in"} = f, params, n) do
    dialect = Rocket.Store.dialect()
    {clause, extra_params, n} = dialect.in_expr(f.field, f.value, n)
    {clause, params ++ extra_params, n}
  end

  defp build_where_clause(%WhereClause{operator: "not_in"} = f, params, n) do
    dialect = Rocket.Store.dialect()
    {clause, extra_params, n} = dialect.not_in_expr(f.field, f.value, n)
    {clause, params ++ extra_params, n}
  end

  defp build_where_clause(%WhereClause{} = f, params, n) do
    n = n + 1
    ph = "$#{n}"
    params = params ++ [f.value]

    clause =
      case f.operator do
        "eq" -> "#{f.field} = #{ph}"
        "neq" -> "#{f.field} != #{ph}"
        "gt" -> "#{f.field} > #{ph}"
        "gte" -> "#{f.field} >= #{ph}"
        "lt" -> "#{f.field} < #{ph}"
        "lte" -> "#{f.field} <= #{ph}"
        "like" -> "#{f.field} LIKE #{ph}"
        _ -> "#{f.field} = #{ph}"
      end

    {clause, params, n}
  end

  defp parse_filter_key(key) do
    case String.split(key, ".", parts: 2) do
      [field, op] -> {field, op}
      [field] -> {field, "eq"}
    end
  end

  defp coerce_value(field, val, op) when op in ["in", "not_in"] do
    parts = String.split(val, ",")

    results =
      Enum.map(parts, fn p ->
        coerce_single_value(field, String.trim(p))
      end)

    case Enum.find(results, &match?({:error, _}, &1)) do
      nil -> {:ok, Enum.map(results, fn {:ok, v} -> v end)}
      err -> err
    end
  end

  defp coerce_value(field, val, _op), do: coerce_single_value(field, val)

  defp coerce_single_value(%{type: "int"}, val) do
    case Integer.parse(val) do
      {n, ""} -> {:ok, n}
      _ -> {:error, "expected integer"}
    end
  end

  defp coerce_single_value(%{type: "bigint"}, val) do
    case Integer.parse(val) do
      {n, ""} -> {:ok, n}
      _ -> {:error, "expected integer"}
    end
  end

  defp coerce_single_value(%{type: "decimal"}, val) do
    case Float.parse(val) do
      {n, ""} -> {:ok, n}
      _ -> {:error, "expected number"}
    end
  end

  defp coerce_single_value(%{type: "boolean"}, val) do
    case val do
      v when v in ["true", "1"] -> {:ok, true}
      v when v in ["false", "0"] -> {:ok, false}
      _ -> {:error, "expected boolean"}
    end
  end

  defp coerce_single_value(_, val), do: {:ok, val}

  defp parse_int(val, default) when is_binary(val) do
    case Integer.parse(val) do
      {n, ""} -> n
      _ -> default
    end
  end

  defp parse_int(val, _) when is_integer(val), do: val
  defp parse_int(_, default), do: default
end
