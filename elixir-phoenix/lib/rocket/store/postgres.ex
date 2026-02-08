defmodule Rocket.Store.Postgres do
  @moduledoc "Raw SQL helpers wrapping Postgrex/Ecto results to [%{}] maps."

  @doc "Execute query, return {:ok, [%{}]} or {:error, reason}"
  def query_rows(conn, sql, params \\ []) do
    case do_query(conn, sql, params) do
      {:ok, %Postgrex.Result{columns: nil}} ->
        {:ok, []}

      {:ok, %Postgrex.Result{columns: cols, rows: rows}} ->
        {:ok, Enum.map(rows, fn row -> row_to_map(cols, row) end)}

      {:error, %Postgrex.Error{postgres: %{code: :unique_violation}} = err} ->
        {:error, {:unique_violation, err}}

      {:error, err} ->
        {:error, err}
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
      {:ok, %Postgrex.Result{num_rows: n}} ->
        {:ok, n}

      {:error, %Postgrex.Error{postgres: %{code: :unique_violation}} = err} ->
        {:error, {:unique_violation, err}}

      {:error, err} ->
        {:error, err}
    end
  end

  @doc "Execute raw SQL ignoring result (for DDL statements)."
  def exec!(conn, sql, params \\ []) do
    case exec(conn, sql, params) do
      {:ok, _} -> :ok
      {:error, err} -> raise "SQL exec failed: #{inspect(err)}"
    end
  end

  defp do_query(conn, sql, params) when is_atom(conn) do
    encoded = encode_params(params)
    Ecto.Adapters.SQL.query(conn, sql, encoded)
  end

  defp do_query(conn, sql, params) when is_pid(conn) do
    Postgrex.query(conn, sql, encode_params(params))
  end

  defp do_query(conn, sql, params) do
    Postgrex.query(conn, sql, encode_params(params))
  end

  # Postgrex expects UUID params as 16-byte binaries, not strings.
  # Convert UUID-formatted strings to binary so the rest of the app
  # can work with human-readable UUIDs (matching Go/Express behavior).
  defp encode_params(params) do
    Enum.map(params, &encode_param/1)
  end

  defp encode_param(val) when is_binary(val) and byte_size(val) == 36 do
    hex = String.replace(val, "-", "")

    case Base.decode16(hex, case: :mixed) do
      {:ok, bin} when byte_size(bin) == 16 -> bin
      _ -> val
    end
  end

  defp encode_param(val), do: val

  defp row_to_map(cols, row) do
    cols
    |> Enum.zip(row)
    |> Map.new(fn {col, val} -> {col, normalize_value(val)} end)
  end

  defp normalize_value(%Decimal{} = d), do: Decimal.to_float(d)
  defp normalize_value(%NaiveDateTime{} = ndt), do: NaiveDateTime.to_iso8601(ndt)
  defp normalize_value(%DateTime{} = dt), do: DateTime.to_iso8601(dt)
  defp normalize_value(%Date{} = d), do: Date.to_iso8601(d)
  defp normalize_value(%Time{} = t), do: Time.to_iso8601(t)
  defp normalize_value(list) when is_list(list), do: Enum.map(list, &normalize_value/1)

  # Postgrex returns UUIDs as 16-byte raw binaries; convert to string form
  defp normalize_value(bin) when is_binary(bin) and byte_size(bin) == 16 do
    case Ecto.UUID.load(bin) do
      {:ok, uuid_string} -> uuid_string
      _ -> bin
    end
  end

  defp normalize_value(val), do: val

  @doc "Check if a database name is safe (lowercase alphanumeric + underscore)."
  def valid_db_name?(name) when is_binary(name) do
    byte_size(name) > 0 and byte_size(name) <= 63 and
      Regex.match?(~r/^[a-z0-9_]+$/, name)
  end

  def valid_db_name?(_), do: false

  @doc "Create a database. Must be run outside a transaction."
  def create_database(conn, db_name) do
    if valid_db_name?(db_name) do
      exec(conn, "CREATE DATABASE #{db_name}")
    else
      {:error, "invalid database name: #{db_name}"}
    end
  end

  @doc "Drop a database. Must be run outside a transaction."
  def drop_database(conn, db_name) do
    if valid_db_name?(db_name) do
      exec(conn, "DROP DATABASE IF EXISTS #{db_name}")
    else
      {:error, "invalid database name: #{db_name}"}
    end
  end
end
