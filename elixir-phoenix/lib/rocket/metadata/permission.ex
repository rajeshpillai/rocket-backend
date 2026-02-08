defmodule Rocket.Metadata.Permission do
  defstruct [:id, :entity, :action, roles: [], conditions: []]
end

defmodule Rocket.Metadata.PermissionCondition do
  defstruct [:field, :value, operator: "eq"]
end
