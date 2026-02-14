defmodule RocketWeb.EventController do
  @moduledoc "Event API endpoints: emit, list, trace waterfall, stats."
  use RocketWeb, :controller

  alias Rocket.Store.Postgres
  alias Rocket.Engine.AppError
  alias Rocket.Instrument.Instrumenter

  # POST /api/:app/_events — emit a custom business event (any authenticated user)
  def emit(conn, params) do
    action = params["action"]

    if !action || action == "" do
      respond_error(conn, AppError.new("VALIDATION_FAILED", 422, "action is required"))
    else
      entity = params["entity"] || ""
      record_id = params["record_id"] || ""
      metadata = params["metadata"]

      Instrumenter.emit_business_event(action, entity, record_id, metadata)

      json(conn, %{data: %{status: "ok"}})
    end
  end

  # GET /api/:app/_events — list events with filters (admin only)
  def list_events(conn, params) do
    db = get_conn(conn)

    {conditions, args, arg_idx} =
      [
        {"source", "source"},
        {"component", "component"},
        {"action", "action"},
        {"entity", "entity"},
        {"event_type", "event_type"},
        {"trace_id", "trace_id"},
        {"user_id", "user_id"},
        {"status", "status"}
      ]
      |> Enum.reduce({[], [], 1}, fn {param_key, col}, {conds, args, idx} ->
        case params[param_key] do
          val when is_binary(val) and val != "" ->
            {conds ++ ["#{col} = $#{idx}"], args ++ [val], idx + 1}
          _ ->
            {conds, args, idx}
        end
      end)

    {conditions, args, arg_idx} =
      case params["from"] do
        val when is_binary(val) and val != "" ->
          {conditions ++ ["created_at >= $#{arg_idx}"], args ++ [val], arg_idx + 1}
        _ ->
          {conditions, args, arg_idx}
      end

    {conditions, args, arg_idx} =
      case params["to"] do
        val when is_binary(val) and val != "" ->
          {conditions ++ ["created_at <= $#{arg_idx}"], args ++ [val], arg_idx + 1}
        _ ->
          {conditions, args, arg_idx}
      end

    # Pagination
    page = max(1, parse_int(params["page"], 1))
    per_page = parse_int(params["per_page"], 50) |> min(100) |> max(1)
    offset = (page - 1) * per_page

    # Sort
    order_by =
      case params["sort"] do
        "created_at" -> "created_at ASC"
        _ -> "created_at DESC"
      end

    where_clause = if conditions == [], do: "", else: " WHERE " <> Enum.join(conditions, " AND ")

    # Count
    count_sql = "SELECT COUNT(*) as count FROM _events#{where_clause}"

    total =
      case Postgres.query_row(db, count_sql, args) do
        {:ok, %{"count" => c}} -> c
        _ -> 0
      end

    # Data
    data_sql =
      "SELECT id, trace_id, span_id, parent_span_id, event_type, source, component, action, " <>
      "entity, record_id, user_id, duration_ms, status, metadata, created_at " <>
      "FROM _events#{where_clause} ORDER BY #{order_by} LIMIT $#{arg_idx} OFFSET $#{arg_idx + 1}"

    data_args = args ++ [per_page, offset]

    rows =
      case Postgres.query_rows(db, data_sql, data_args) do
        {:ok, rows} -> rows || []
        _ -> []
      end

    json(conn, %{
      data: rows,
      pagination: %{page: page, per_page: per_page, total: total}
    })
  end

  # GET /api/:app/_events/trace/:trace_id — full trace waterfall (admin only)
  def get_trace(conn, %{"trace_id" => trace_id}) do
    db = get_conn(conn)

    sql =
      "SELECT id, trace_id, span_id, parent_span_id, event_type, source, component, action, " <>
      "entity, record_id, user_id, duration_ms, status, metadata, created_at " <>
      "FROM _events WHERE trace_id = $1 ORDER BY created_at ASC"

    case Postgres.query_rows(db, sql, [trace_id]) do
      {:ok, rows} when is_list(rows) and rows != [] ->
        # Build tree from spans
        span_map =
          Map.new(rows, fn row ->
            {row["span_id"], Map.put(row, "children", [])}
          end)

        # Link children to parents
        {span_map, root_span} =
          Enum.reduce(rows, {span_map, nil}, fn row, {sm, root} ->
            parent_id = row["parent_span_id"]

            cond do
              parent_id != nil && Map.has_key?(sm, parent_id) ->
                parent = sm[parent_id]
                parent = %{parent | "children" => parent["children"] ++ [sm[row["span_id"]]]}
                {Map.put(sm, parent_id, parent), root}

              parent_id == nil ->
                {sm, sm[row["span_id"]]}

              true ->
                {sm, root}
            end
          end)

        # If no explicit root, use first span
        root_span = root_span || span_map[hd(rows)["span_id"]]

        # Rebuild root with updated children (need to re-traverse)
        root_span = rebuild_tree(span_map, root_span)

        total_duration =
          if root_span && root_span["duration_ms"] != nil,
            do: root_span["duration_ms"],
            else: nil

        json(conn, %{
          data: %{
            trace_id: trace_id,
            root_span: root_span,
            spans: rows,
            total_duration_ms: total_duration
          }
        })

      _ ->
        respond_error(conn, AppError.new("NOT_FOUND", 404, "Trace not found: #{trace_id}"))
    end
  end

  # GET /api/:app/_events/stats — aggregate stats (admin only)
  def get_stats(conn, params) do
    db = get_conn(conn)

    {conditions, args, _arg_idx} =
      Enum.reduce(
        [{"from", "created_at >= "}, {"to", "created_at <= "}, {"entity", "entity = "}],
        {["duration_ms IS NOT NULL"], [], 1},
        fn {param_key, prefix}, {conds, args, idx} ->
          case params[param_key] do
            val when is_binary(val) and val != "" ->
              {conds ++ ["#{prefix}$#{idx}"], args ++ [val], idx + 1}
            _ ->
              {conds, args, idx}
          end
        end
      )

    where_clause = " WHERE " <> Enum.join(conditions, " AND ")

    by_source_sql =
      "SELECT source, COUNT(*) as count, AVG(duration_ms) as avg_duration_ms, " <>
      "percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_duration_ms, " <>
      "COUNT(*) FILTER (WHERE status = 'error') as error_count " <>
      "FROM _events#{where_clause} GROUP BY source ORDER BY count DESC"

    by_source =
      case Postgres.query_rows(db, by_source_sql, args) do
        {:ok, rows} ->
          Enum.map(rows || [], fn row ->
            %{
              source: row["source"],
              count: row["count"],
              avg_duration_ms: row["avg_duration_ms"],
              p95_duration_ms: row["p95_duration_ms"],
              error_count: row["error_count"]
            }
          end)
        _ -> []
      end

    # Overall stats (all events, not just those with duration_ms)
    {overall_conds, overall_args, _} =
      Enum.reduce(
        [{"from", "created_at >= "}, {"to", "created_at <= "}, {"entity", "entity = "}],
        {[], [], 1},
        fn {param_key, prefix}, {conds, args, idx} ->
          case params[param_key] do
            val when is_binary(val) and val != "" ->
              {conds ++ ["#{prefix}$#{idx}"], args ++ [val], idx + 1}
            _ ->
              {conds, args, idx}
          end
        end
      )

    overall_where = if overall_conds == [], do: "", else: " WHERE " <> Enum.join(overall_conds, " AND ")

    total_sql =
      "SELECT COUNT(*) as total_events, AVG(duration_ms) as avg_latency_ms, " <>
      "percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_latency_ms, " <>
      "COUNT(*) FILTER (WHERE status = 'error') as error_count " <>
      "FROM _events#{overall_where}"

    {total_events, avg_latency, p95_latency, error_rate} =
      case Postgres.query_row(db, total_sql, overall_args) do
        {:ok, row} ->
          total = row["total_events"] || 0
          errors = row["error_count"] || 0
          rate = if total > 0, do: errors / total, else: 0
          {total, row["avg_latency_ms"], row["p95_latency_ms"], rate}
        _ ->
          {0, nil, nil, 0}
      end

    json(conn, %{
      data: %{
        total_events: total_events,
        avg_latency_ms: avg_latency,
        p95_latency_ms: p95_latency,
        error_rate: error_rate,
        by_source: by_source
      }
    })
  end

  # ── Helpers ──

  defp get_conn(conn), do: conn.assigns[:db_conn] || Rocket.Repo

  defp parse_int(nil, default), do: default
  defp parse_int(val, default) when is_binary(val) do
    case Integer.parse(val) do
      {n, _} -> n
      :error -> default
    end
  end
  defp parse_int(val, _default) when is_integer(val), do: val
  defp parse_int(_, default), do: default

  defp rebuild_tree(_span_map, nil), do: nil

  defp rebuild_tree(span_map, span) do
    children =
      (span["children"] || [])
      |> Enum.map(fn child ->
        # Get latest version of child from span_map
        updated = span_map[child["span_id"]] || child
        rebuild_tree(span_map, updated)
      end)

    %{span | "children" => children}
  end

  defp respond_error(conn, %AppError{} = err) do
    conn
    |> put_status(err.status)
    |> json(%{error: AppError.to_json(err)})
  end
end
