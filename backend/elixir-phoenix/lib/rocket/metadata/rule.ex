defmodule Rocket.Metadata.Rule do
  defstruct [:id, :entity, :hook, :type, :definition, :compiled, priority: 0, active: true]
end

defmodule Rocket.Metadata.RuleDefinition do
  defstruct [:field, :operator, :value, :expression, :message, stop_on_fail: false]
end
