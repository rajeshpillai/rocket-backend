defmodule Rocket.Metadata.UserContext do
  @moduledoc "Represents the authenticated user in request context."

  defstruct [:id, :email, roles: []]

  def admin?(%__MODULE__{roles: roles}), do: "admin" in roles
  def admin?(_), do: false
end
