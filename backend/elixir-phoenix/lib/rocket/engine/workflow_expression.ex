defmodule Rocket.Engine.WorkflowExpression do
  @moduledoc """
  Behaviour for workflow condition expression evaluation.
  Wraps the existing Expression module with a stable interface.
  """

  @callback evaluate_bool(expression :: String.t(), env :: map()) ::
              {:ok, boolean()} | {:error, term()}
end

defmodule Rocket.Engine.DefaultWorkflowExpression do
  @moduledoc "Default implementation using the built-in Expression module."
  @behaviour Rocket.Engine.WorkflowExpression

  alias Rocket.Engine.Expression

  @impl true
  def evaluate_bool(expression, env) do
    Expression.evaluate_bool(expression, env)
  end
end
