defmodule Rocket.Metadata.StateMachine do
  defstruct [:id, :entity, :field, :definition, active: true]
end

defmodule Rocket.Metadata.StateMachineDefinition do
  defstruct [:initial_state, states: [], transitions: []]
end

defmodule Rocket.Metadata.Transition do
  defstruct [:to, :guard, from: [], roles: [], actions: []]
end

defmodule Rocket.Metadata.TransitionAction do
  defstruct [:type, :field, :value, :url, :method, :entity, :data]
end
