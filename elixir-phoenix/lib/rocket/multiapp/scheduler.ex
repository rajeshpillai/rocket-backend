defmodule Rocket.MultiApp.Scheduler do
  @moduledoc "Multi-app background scheduler: iterates all app contexts for workflow timeouts and webhook retries."
  use GenServer
  require Logger

  alias Rocket.MultiApp.AppManager

  @workflow_interval 60_000
  @webhook_interval 30_000

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    schedule_workflows()
    schedule_webhooks()
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

  def handle_info(_msg, state), do: {:noreply, state}

  defp schedule_workflows do
    Process.send_after(self(), :workflow_tick, @workflow_interval)
  end

  defp schedule_webhooks do
    Process.send_after(self(), :webhook_tick, @webhook_interval)
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
end
