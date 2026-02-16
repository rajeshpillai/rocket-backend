defmodule Rocket.Store.Dialect do
  @moduledoc """
  Behaviour defining the database abstraction layer.

  Each dialect (PostgreSQL, SQLite) implements these callbacks to handle
  SQL generation differences, type mapping, and database-specific operations.
  """

  # ---------------------------------------------------------------------------
  # Metadata
  # ---------------------------------------------------------------------------

  @doc "Returns the dialect name, e.g. \"postgres\" or \"sqlite\"."
  @callback name() :: String.t()

  @doc "Returns the parameter placeholder for the given 1-based index (e.g. \"$1\" for Postgres, \"?1\" for SQLite)."
  @callback placeholder(n :: integer()) :: String.t()

  @doc "Returns the SQL expression for the current timestamp."
  @callback now_expr() :: String.t()

  @doc """
  Returns the DDL DEFAULT clause for auto-generated UUIDs,
  or an empty string if UUIDs must be generated in application code.
  """
  @callback uuid_default() :: String.t()

  # ---------------------------------------------------------------------------
  # DDL / types
  # ---------------------------------------------------------------------------

  @doc "Maps a metadata field type to the database DDL column type."
  @callback column_type(field_type :: String.t(), precision :: integer() | nil) :: String.t()

  @doc "Returns the DDL for all per-app system tables."
  @callback system_tables_sql() :: String.t()

  @doc "Returns the DDL for platform management tables."
  @callback platform_tables_sql() :: String.t()

  # ---------------------------------------------------------------------------
  # Introspection
  # ---------------------------------------------------------------------------

  @doc "Checks whether a table exists in the database."
  @callback table_exists?(conn :: term(), table_name :: String.t()) :: boolean()

  @doc "Returns existing column names and types for a table as a map of %{column_name => column_type}."
  @callback get_columns(conn :: term(), table_name :: String.t()) :: map()

  # ---------------------------------------------------------------------------
  # Index helpers
  # ---------------------------------------------------------------------------

  @doc "Returns the CREATE INDEX statement for soft-delete filtering."
  @callback soft_delete_index_sql(table :: String.t()) :: String.t()

  # ---------------------------------------------------------------------------
  # Query expression helpers
  # ---------------------------------------------------------------------------

  @doc """
  Builds a SQL expression for the IN operator.

  PostgreSQL: `field = ANY($n)` with a single array param.
  SQLite: `field IN (?n, ?n+1, ...)` expanding the list.

  Returns `{sql_fragment, param_values, next_param_offset}`.
  """
  @callback in_expr(field :: String.t(), values :: list(), param_offset :: integer()) ::
              {String.t(), list(), integer()}

  @doc """
  Builds a SQL expression for the NOT IN operator.

  Returns `{sql_fragment, param_values, next_param_offset}`.
  """
  @callback not_in_expr(field :: String.t(), values :: list(), param_offset :: integer()) ::
              {String.t(), list(), integer()}

  @doc """
  Returns SQL for deleting rows older than N days.

  Returns `{sql_fragment, next_param_offset}`.
  """
  @callback interval_delete_expr(col :: String.t(), param_offset :: integer()) ::
              {String.t(), integer()}

  # ---------------------------------------------------------------------------
  # Array encoding / decoding
  # ---------------------------------------------------------------------------

  @doc """
  Encodes a string list for storage.

  PostgreSQL: returns the list as-is (Postgrex handles TEXT[]).
  SQLite: JSON-encodes to a string.
  """
  @callback array_param(values :: list(String.t())) :: term()

  @doc """
  Decodes a TEXT[] (PostgreSQL) or JSON string (SQLite) into a list of strings.
  """
  @callback scan_array(raw :: term()) :: list(String.t())

  # ---------------------------------------------------------------------------
  # Aggregate helpers
  # ---------------------------------------------------------------------------

  @doc """
  Returns SQL for conditional counting.

  PostgreSQL: `COUNT(*) FILTER (WHERE condition)`
  SQLite: `SUM(CASE WHEN condition THEN 1 ELSE 0 END)`
  """
  @callback filter_count_expr(condition :: String.t()) :: String.t()

  # ---------------------------------------------------------------------------
  # Performance / capability flags
  # ---------------------------------------------------------------------------

  @doc """
  Returns SQL to disable synchronous commit in a transaction,
  or nil if not applicable (SQLite).
  """
  @callback sync_commit_off() :: String.t() | nil

  @doc "Returns true if the database supports percentile_cont."
  @callback supports_percentile?() :: boolean()

  @doc "Returns true if boolean columns come back as integers (SQLite)."
  @callback needs_bool_fix?() :: boolean()

  # ---------------------------------------------------------------------------
  # Database lifecycle
  # ---------------------------------------------------------------------------

  @doc "Creates a new database (PostgreSQL) or database file (SQLite)."
  @callback create_database(conn :: term(), db_name :: String.t(), data_dir :: String.t()) ::
              :ok | {:error, term()}

  @doc "Drops a database (PostgreSQL) or deletes the database file (SQLite)."
  @callback drop_database(conn :: term(), db_name :: String.t(), data_dir :: String.t()) ::
              :ok | {:error, term()}

  # ---------------------------------------------------------------------------
  # Factory
  # ---------------------------------------------------------------------------

  @doc """
  Returns the dialect module atom for the given driver string.

  ## Examples

      iex> Rocket.Store.Dialect.new("sqlite")
      Rocket.Store.DialectSqlite

      iex> Rocket.Store.Dialect.new("postgres")
      Rocket.Store.DialectPostgres
  """
  @spec new(String.t()) :: module()
  def new("sqlite"), do: Rocket.Store.DialectSqlite
  def new(_), do: Rocket.Store.DialectPostgres
end
