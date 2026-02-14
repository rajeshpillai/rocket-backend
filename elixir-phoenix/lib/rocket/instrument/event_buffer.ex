defmodule Rocket.Instrument.EventBuffer do
  @moduledoc "GenServer that buffers events in memory and batch-flushes to PostgreSQL."
  use GenServer
  require Logger

  @cols ~w(trace_id span_id parent_span_id event_type source component action entity record_id user_id duration_ms status metadata)

  def start_link(opts) do
    pool = Keyword.fetch!(opts, :pool)
    max_size = Keyword.get(opts, :max_size, 500)
    flush_interval = Keyword.get(opts, :flush_interval, 100)
    name = Keyword.get(opts, :name)

    GenServer.start_link(__MODULE__, %{pool: pool, max_size: max_size, flush_interval: flush_interval}, name: name)
  end

  def enqueue(pid, event) do
    GenServer.cast(pid, {:enqueue, event})
  end

  def stop(pid) do
    GenServer.call(pid, :stop)
  catch
    :exit, _ -> :ok
  end

  # ── Server Callbacks ──

  @impl true
  def init(state) do
    schedule_flush(state.flush_interval)
    {:ok, Map.put(state, :events, [])}
  end

  @impl true
  def handle_cast({:enqueue, event}, state) do
    events = [event | state.events]

    if length(events) >= state.max_size do
      flush(events, state.pool)
      {:noreply, %{state | events: []}}
    else
      {:noreply, %{state | events: events}}
    end
  end

  @impl true
  def handle_call(:stop, _from, state) do
    if state.events != [] do
      flush(state.events, state.pool)
    end
    {:stop, :normal, :ok, %{state | events: []}}
  end

  @impl true
  def handle_info(:flush_tick, state) do
    if state.events != [] do
      flush(state.events, state.pool)
    end
    schedule_flush(state.flush_interval)
    {:noreply, %{state | events: []}}
  end

  def handle_info(_msg, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, state) do
    if state.events != [] do
      flush(state.events, state.pool)
    end
    :ok
  end

  # ── Private ──

  defp schedule_flush(interval) do
    Process.send_after(self(), :flush_tick, interval)
  end

  defp flush(events, pool) do
    batch = Enum.reverse(events)
    n = length(batch)

    {placeholders, params} =
      batch
      |> Enum.with_index()
      |> Enum.reduce({[], []}, fn {event, i}, {phs, ps} ->
        offset = i * length(@cols)
        ph = "(#{Enum.map_join(1..length(@cols), ", ", fn j -> "$#{offset + j}" end)})"

        vals = [
          event.trace_id,
          event.span_id,
          event.parent_span_id,
          event.event_type,
          event.source,
          event.component,
          event.action,
          event.entity,
          event.record_id,
          event.user_id,
          event.duration_ms,
          event.status,
          encode_metadata(event.metadata)
        ]

        {phs ++ [ph], ps ++ vals}
      end)

    sql = "INSERT INTO _events (#{Enum.join(@cols, ", ")}) VALUES #{Enum.join(placeholders, ", ")}"

    try do
      Postgrex.query(pool, "SET LOCAL synchronous_commit = off", [])
      Postgrex.query(pool, sql, params)
    rescue
      e -> Logger.error("Event buffer flush failed (#{n} events): #{inspect(e)}")
    catch
      _, e -> Logger.error("Event buffer flush failed (#{n} events): #{inspect(e)}")
    end
  end

  defp encode_metadata(nil), do: nil
  defp encode_metadata(m) when is_map(m) and map_size(m) == 0, do: nil
  defp encode_metadata(m) when is_map(m), do: Jason.encode!(m)
  defp encode_metadata(_), do: nil
end
