defmodule Rocket.Engine.WorkflowScheduler do
  @moduledoc "Background GenServer that processes workflow timeouts on a 60s tick."
  use GenServer
  require Logger

  @tick_interval 60_000

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    schedule_tick()
    {:ok, %{}}
  end

  @impl true
  def handle_info(:tick, state) do
    process_timeouts()
    schedule_tick()
    {:noreply, state}
  end

  def handle_info(_msg, state), do: {:noreply, state}

  defp schedule_tick do
    Process.send_after(self(), :tick, @tick_interval)
  end

  defp process_timeouts do
    try do
      conn = Rocket.Store.mgmt_conn()
      registry = Rocket.Metadata.Registry
      Rocket.Engine.WorkflowEngine.process_timeouts(conn, registry)
    rescue
      e ->
        Logger.error("Workflow scheduler error: #{inspect(e)}")
    end
  end
end
