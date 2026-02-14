defmodule Rocket.Store do
  @moduledoc "Driver-agnostic SQL helpers wrapping Postgrex/Exqlite results to [%{}] maps."

  @doc "Get the management database connection."
  def mgmt_conn, do: Application.get_env(:rocket, :mgmt_conn) || Rocket.Repo

  @doc "Get the current dialect module. Checks process dictionary first (per-app), then global."
  def dialect do
    Process.get(:rocket_dialect) || Application.get_env(:rocket, :dialect) || Rocket.Store.DialectPostgres
  end

  @doc "Execute query, return {:ok, [%{}]} or {:error, reason}"
  def query_rows(conn, sql, params \\ []) do
    case do_query(conn, sql, params) do
      {:ok, %{columns: nil}} ->
        {:ok, []}

      {:ok, %{columns: cols, rows: rows}} when is_list(cols) ->
        {:ok, Enum.map(rows, fn row -> row_to_map(cols, row) end)}

      {:error, err} ->
        {:error, map_error(err)}
    end
  end

  @doc "Execute query, return {:ok, %{}} or {:error, :not_found} or {:error, reason}"
  def query_row(conn, sql, params \\ []) do
    case query_rows(conn, sql, params) do
      {:ok, [row | _]} -> {:ok, row}
      {:ok, []} -> {:error, :not_found}
      {:error, _} = err -> err
    end
  end

  @doc "Execute statement, return {:ok, num_rows} or {:error, reason}"
  def exec(conn, sql, params \\ []) do
    case do_query(conn, sql, params) do
      {:ok, %{num_rows: n}} ->
        {:ok, n}

      {:ok, _} ->
        {:ok, 0}

      {:error, err} ->
        {:error, map_error(err)}
    end
  end

  @doc "Execute raw SQL ignoring result (for DDL statements)."
  def exec!(conn, sql, params \\ []) do
    case exec(conn, sql, params) do
      {:ok, _} -> :ok
      {:error, err} -> raise "SQL exec failed: #{inspect(err)}"
    end
  end

  @doc "Execute a transaction. Dispatches to Postgrex or DBConnection based on dialect."
  def transaction(conn, fun) when is_pid(conn) do
    case dialect().name() do
      "postgres" -> Postgrex.transaction(conn, fun)
      "sqlite" -> DBConnection.transaction(conn, fun)
    end
  end

  def transaction(conn, fun) when is_atom(conn) do
    conn.transaction(fun)
  end

  # ── Query dispatch ──

  # Ecto Repo (atom) — PostgreSQL only, SQLite doesn't use Ecto repos
  defp do_query(conn, sql, params) when is_atom(conn) do
    encoded = encode_params_pg(params)
    Ecto.Adapters.SQL.query(conn, sql, encoded)
  end

  # PID-based connection — dispatch on dialect
  defp do_query(conn, sql, params) when is_pid(conn) do
    case dialect().name() do
      "postgres" ->
        Postgrex.query(conn, sql, encode_params_pg(params))

      "sqlite" ->
        adapted_sql = adapt_sql_for_sqlite(sql)
        Exqlite.query(conn, adapted_sql, encode_params_sqlite(params))
    end
  end

  # Fallback (e.g. DBConnection ref)
  defp do_query(conn, sql, params) do
    case dialect().name() do
      "postgres" ->
        Postgrex.query(conn, sql, encode_params_pg(params))

      "sqlite" ->
        adapted_sql = adapt_sql_for_sqlite(sql)
        Exqlite.query(conn, adapted_sql, encode_params_sqlite(params))
    end
  end

  # ── SQL auto-conversion for SQLite ──

  defp adapt_sql_for_sqlite(sql) do
    sql
    |> String.replace(~r/\$(\d+)/, "?\\1")
    |> String.replace("NOW()", "datetime('now')")
  end

  # ── PostgreSQL param encoding ──
  # Postgrex expects UUID params as 16-byte binaries, not strings.

  defp encode_params_pg(params) do
    Enum.map(params, &encode_param_pg/1)
  end

  defp encode_param_pg(val) when is_binary(val) and byte_size(val) == 36 do
    hex = String.replace(val, "-", "")

    case Base.decode16(hex, case: :mixed) do
      {:ok, bin} when byte_size(bin) == 16 -> bin
      _ -> val
    end
  end

  # Recurse into lists (e.g., UUID arrays passed to ANY($1))
  defp encode_param_pg(val) when is_list(val) do
    Enum.map(val, &encode_param_pg/1)
  end

  defp encode_param_pg(val), do: val

  # ── SQLite param encoding ──
  # Exqlite cannot handle maps, lists, booleans, or DateTime structs natively.

  defp encode_params_sqlite(params) do
    Enum.map(params, &encode_param_sqlite/1)
  end

  defp encode_param_sqlite(val) when is_map(val), do: Jason.encode!(val)
  defp encode_param_sqlite(val) when is_list(val), do: Jason.encode!(val)
  defp encode_param_sqlite(true), do: 1
  defp encode_param_sqlite(false), do: 0
  defp encode_param_sqlite(%DateTime{} = dt), do: DateTime.to_iso8601(dt)
  defp encode_param_sqlite(%NaiveDateTime{} = ndt), do: NaiveDateTime.to_iso8601(ndt)
  defp encode_param_sqlite(%Date{} = d), do: Date.to_iso8601(d)
  defp encode_param_sqlite(val), do: val

  # ── Result normalization ──

  defp row_to_map(cols, row) do
    d = dialect()

    cols
    |> Enum.zip(row)
    |> Map.new(fn {col, val} -> {col, normalize_value(val, d)} end)
  end

  defp normalize_value(%Decimal{} = d, _dialect), do: Decimal.to_float(d)
  defp normalize_value(%NaiveDateTime{} = ndt, _dialect), do: NaiveDateTime.to_iso8601(ndt)
  defp normalize_value(%DateTime{} = dt, _dialect), do: DateTime.to_iso8601(dt)
  defp normalize_value(%Date{} = d, _dialect), do: Date.to_iso8601(d)
  defp normalize_value(%Time{} = t, _dialect), do: Time.to_iso8601(t)
  defp normalize_value(list, dialect) when is_list(list), do: Enum.map(list, &normalize_value(&1, dialect))

  # Postgrex returns UUIDs as 16-byte raw binaries; convert to string form.
  # Skip for SQLite — UUIDs are plain TEXT strings.
  # Guard: only convert non-printable binaries (raw UUID bytes), not regular 16-char text strings.
  defp normalize_value(bin, dialect) when is_binary(bin) and byte_size(bin) == 16 do
    if dialect.name() == "sqlite" or String.printable?(bin) do
      bin
    else
      case Ecto.UUID.load(bin) do
        {:ok, uuid_string} -> uuid_string
        _ -> bin
      end
    end
  end

  # SQLite: auto-decode JSON strings (JSONB columns are TEXT in SQLite).
  # PostgreSQL Postgrex auto-deserializes JSONB → map/list; replicate that for SQLite.
  defp normalize_value(str, dialect) when is_binary(str) and byte_size(str) > 1 do
    if dialect.name() == "sqlite" do
      first = :binary.first(str)

      if first == ?{ or first == ?[ do
        case Jason.decode(str) do
          {:ok, decoded} -> decoded
          _ -> str
        end
      else
        str
      end
    else
      str
    end
  end

  defp normalize_value(val, _dialect), do: val

  @doc "Convert SQLite integer (0/1) to boolean. Use at point-of-use for known boolean columns."
  def to_bool(val) when val in [false, 0, nil], do: false
  def to_bool(_), do: true

  @doc "Normalize boolean fields in entity result rows (SQLite returns 0/1 for booleans)."
  def fix_booleans(rows, entity) when is_list(rows) do
    if dialect().name() == "sqlite" do
      bool_fields = for f <- entity.fields, f.type == "boolean", do: f.name
      if bool_fields == [], do: rows, else: Enum.map(rows, &fix_row_bools(&1, bool_fields))
    else
      rows
    end
  end

  def fix_booleans(row, entity) when is_map(row) do
    case fix_booleans([row], entity) do
      [fixed] -> fixed
      _ -> row
    end
  end

  defp fix_row_bools(row, bool_fields) do
    Enum.reduce(bool_fields, row, fn field, acc ->
      if Map.has_key?(acc, field) do
        Map.put(acc, field, to_bool(Map.get(acc, field)))
      else
        acc
      end
    end)
  end

  # ── Error mapping ──

  defp map_error(%Postgrex.Error{postgres: %{code: :unique_violation}} = err) do
    {:unique_violation, err}
  end

  defp map_error(%{message: msg} = err) when is_binary(msg) do
    if String.contains?(msg, "UNIQUE constraint failed") do
      {:unique_violation, err}
    else
      err
    end
  end

  defp map_error(err), do: err

  # ── Utilities ──

  @doc "Check if a database name is safe (lowercase alphanumeric + underscore)."
  def valid_db_name?(name) when is_binary(name) do
    byte_size(name) > 0 and byte_size(name) <= 63 and
      Regex.match?(~r/^[a-z0-9_]+$/, name)
  end

  def valid_db_name?(_), do: false
end
