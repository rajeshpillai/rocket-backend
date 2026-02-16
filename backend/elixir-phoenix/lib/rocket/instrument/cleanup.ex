defmodule Rocket.Instrument.Cleanup do
  @moduledoc "Retention cleanup for old events."

  alias Rocket.Store
  require Logger

  @doc "Delete events older than retention_days. Logs internally."
  def cleanup_old_events(pool, retention_days) do
    dialect = Store.dialect()
    {interval_clause, _n} = dialect.interval_delete_expr("created_at", 0)
    sql = "DELETE FROM _events WHERE #{interval_clause}"

    case Store.exec(pool, sql, [to_string(retention_days)]) do
      {:ok, n} when n > 0 ->
        Logger.info("Event cleanup: deleted #{n} events older than #{retention_days} days")

      {:ok, _} ->
        :ok

      {:error, err} ->
        Logger.error("Event cleanup failed: #{inspect(err)}")
    end
  end
end
