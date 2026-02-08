defmodule Rocket.Metadata.Workflow do
  defstruct [:id, :name, :trigger, :context, steps: [], active: true]
end

defmodule Rocket.Metadata.WorkflowTrigger do
  defstruct [:type, :entity, :field, :to]
end

defmodule Rocket.Metadata.WorkflowStep do
  defstruct [
    :id,
    :name,
    :type,
    :condition,
    :on_true,
    :on_false,
    :on_approve,
    :on_reject,
    :on_timeout,
    :deadline,
    :next,
    actions: [],
    roles: []
  ]
end
