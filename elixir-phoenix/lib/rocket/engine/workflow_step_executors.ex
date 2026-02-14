defmodule Rocket.Engine.StepExecutor do
  @moduledoc """
  Behaviour for executing a single workflow step type.
  Returns {:paused, instance} | {:next, goto, instance} | {:error, reason, instance}.
  """

  @callback execute(conn :: term(), ctx :: map(), instance :: map(), step :: map()) ::
              {:paused, map()} | {:next, String.t() | nil, map()} | {:error, term(), map()}
end

defmodule Rocket.Engine.StepExecutors.Action do
  @moduledoc "Runs all actions in an action step sequentially."
  @behaviour Rocket.Engine.StepExecutor

  @impl true
  def execute(conn, ctx, instance, step) do
    actions = step_field(step, :actions) || []

    result =
      Enum.reduce_while(actions, :ok, fn action, :ok ->
        executor = Map.get(ctx.action_executors, action["type"] || "")

        if executor do
          case executor.execute(conn, ctx.registry, instance, action) do
            :ok -> {:cont, :ok}
            {:error, err} -> {:halt, {:error, err}}
          end
        else
          {:cont, :ok}
        end
      end)

    case result do
      :ok ->
        entry = %{"step" => step_field(step, :id), "status" => "completed", "at" => now_iso()}
        instance = %{instance | history: instance.history ++ [entry]}
        next = step_field(step, :next)
        {:next, next, instance}

      {:error, err} ->
        entry = %{"step" => step_field(step, :id), "status" => "failed", "error" => inspect(err), "at" => now_iso()}
        instance = %{instance | history: instance.history ++ [entry]}
        {:error, err, instance}
    end
  end

  defp step_field(step, field) when is_struct(step), do: Map.get(step, field)
  defp step_field(step, field) when is_map(step), do: Map.get(step, to_string(field))
  defp step_field(_, _), do: nil

  defp now_iso, do: DateTime.utc_now() |> DateTime.to_iso8601()
end

defmodule Rocket.Engine.StepExecutors.Condition do
  @moduledoc "Evaluates a boolean expression and branches to on_true or on_false."
  @behaviour Rocket.Engine.StepExecutor

  @impl true
  def execute(_conn, ctx, instance, step) do
    expression = step_field(step, :condition)

    if !expression || expression == "" do
      next = step_field(step, :on_true)
      entry = %{"step" => step_field(step, :id), "status" => "on_true", "at" => now_iso()}
      {:next, next, %{instance | history: instance.history ++ [entry]}}
    else
      env = %{"context" => instance.context}

      case ctx.evaluator.evaluate_bool(expression, env) do
        {:ok, true} ->
          next = step_field(step, :on_true)
          entry = %{"step" => step_field(step, :id), "status" => "on_true", "at" => now_iso()}
          {:next, next, %{instance | history: instance.history ++ [entry]}}

        {:ok, false} ->
          next = step_field(step, :on_false)
          entry = %{"step" => step_field(step, :id), "status" => "on_false", "at" => now_iso()}
          {:next, next, %{instance | history: instance.history ++ [entry]}}

        {:error, err} ->
          {:error, "condition error: #{err}", instance}
      end
    end
  end

  defp step_field(step, field) when is_struct(step), do: Map.get(step, field)
  defp step_field(step, field) when is_map(step), do: Map.get(step, to_string(field))
  defp step_field(_, _), do: nil

  defp now_iso, do: DateTime.utc_now() |> DateTime.to_iso8601()
end

defmodule Rocket.Engine.StepExecutors.Approval do
  @moduledoc "Pauses the workflow and optionally sets a deadline."
  @behaviour Rocket.Engine.StepExecutor

  @impl true
  def execute(_conn, _ctx, instance, step) do
    deadline = step_field(step, :deadline)

    instance =
      if deadline && deadline != "" do
        seconds = parse_duration(deadline)

        if seconds > 0 do
          dt = DateTime.utc_now() |> DateTime.add(seconds, :second)
          %{instance | current_step_deadline: dt}
        else
          instance
        end
      else
        instance
      end

    {:paused, instance}
  end

  defp step_field(step, field) when is_struct(step), do: Map.get(step, field)
  defp step_field(step, field) when is_map(step), do: Map.get(step, to_string(field))
  defp step_field(_, _), do: nil

  defp parse_duration(str) when is_binary(str) do
    cond do
      String.ends_with?(str, "h") ->
        case Integer.parse(String.trim_trailing(str, "h")) do
          {n, ""} -> n * 3600
          _ -> 0
        end

      String.ends_with?(str, "m") ->
        case Integer.parse(String.trim_trailing(str, "m")) do
          {n, ""} -> n * 60
          _ -> 0
        end

      String.ends_with?(str, "s") ->
        case Integer.parse(String.trim_trailing(str, "s")) do
          {n, ""} -> n
          _ -> 0
        end

      true ->
        0
    end
  end

  defp parse_duration(_), do: 0
end

defmodule Rocket.Engine.StepExecutors do
  @moduledoc "Registry of default step executors."

  alias Rocket.Engine.StepExecutors

  def default do
    %{
      "action" => StepExecutors.Action,
      "condition" => StepExecutors.Condition,
      "approval" => StepExecutors.Approval
    }
  end
end
