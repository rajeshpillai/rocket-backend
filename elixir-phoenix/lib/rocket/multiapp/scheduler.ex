defmodule Rocket.MultiApp.Scheduler do
  @moduledoc "Multi-app background scheduler: iterates all app contexts for workflow timeouts and webhook retries."
  use GenServer
  require Logger

  alias Rocket.MultiApp.AppManager

  @workflow_interval 60_000
  @webhook_interval 30_000
  @cleanup_interval 3_600_000

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    schedule_workflows()
    schedule_webhooks()
    schedule_cleanup()
    {:ok, %{}}
  end

  @impl true
  def handle_info(:workflow_tick, state) do
    process_all_workflow_timeouts()
    schedule_workflows()
    {:noreply, state}
  end

  def handle_info(:webhook_tick, state) do
    process_all_webhook_retries()
    schedule_webhooks()
    {:noreply, state}
  end

  def handle_info(:cleanup_tick, state) do
    process_all_event_cleanup()
    schedule_cleanup()
    {:noreply, state}
  end

  def handle_info(_msg, state), do: {:noreply, state}

  defp schedule_workflows do
    Process.send_after(self(), :workflow_tick, @workflow_interval)
  end

  defp schedule_webhooks do
    Process.send_after(self(), :webhook_tick, @webhook_interval)
  end

  defp schedule_cleanup do
    Process.send_after(self(), :cleanup_tick, @cleanup_interval)
  end

  defp process_all_workflow_timeouts do
    contexts = AppManager.all_contexts()

    Enum.each(contexts, fn ctx ->
      try do
        Rocket.Engine.WorkflowEngine.process_timeouts(ctx.db_pool, ctx.registry)
      rescue
        e -> Logger.error("Workflow timeout error for app #{ctx.name}: #{inspect(e)}")
      end
    end)
  rescue
    e -> Logger.error("Multi-app workflow scheduler error: #{inspect(e)}")
  end

  defp process_all_webhook_retries do
    contexts = AppManager.all_contexts()

    Enum.each(contexts, fn ctx ->
      try do
        Rocket.Engine.WebhookScheduler.process_retries_for(ctx.db_pool)
      rescue
        e -> Logger.error("Webhook retry error for app #{ctx.name}: #{inspect(e)}")
      end
    end)
  rescue
    e -> Logger.error("Multi-app webhook scheduler error: #{inspect(e)}")
  end

  defp process_all_event_cleanup do
    instr_config = Application.get_env(:rocket, :instrumentation_config) || %{enabled: true, retention_days: 7}
    if instr_config.enabled do
      contexts = AppManager.all_contexts()
      Enum.each(contexts, fn ctx ->
        try do
          Rocket.Instrument.Cleanup.cleanup_old_events(ctx.db_pool, instr_config.retention_days)
        rescue
          e -> Logger.error("Event cleanup error for app #{ctx.name}: #{inspect(e)}")
        end
      end)
    end
  rescue
    e -> Logger.error("Multi-app event cleanup error: #{inspect(e)}")
  end
end
