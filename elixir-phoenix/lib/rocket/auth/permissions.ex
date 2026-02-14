defmodule Rocket.Auth.Permissions do
  @moduledoc "Permission engine: whitelist model, admin bypass, row-level read filters."

  alias Rocket.Metadata.Registry
  alias Rocket.Instrument.Instrumenter

  @doc "Check if user can perform action on entity. Returns :ok or {:error, AppError}."
  def check_permission(user, entity, action, registry, current_record \\ nil) do
    span = Instrumenter.start_span("auth", "permissions", "permission.check")
    span = Instrumenter.set_entity(span, entity)

    result = do_check_permission(user, entity, action, registry, current_record)

    _span = case result do
      :ok -> Instrumenter.set_status(span, "ok")
      {:error, _} -> Instrumenter.set_status(span, "error")
    end

    Instrumenter.end_span(span)
    result
  end

  defp do_check_permission(user, entity, action, registry, current_record) do
    if user != nil && is_admin?(user) do
      :ok
    else
      if user == nil do
        {:error, Rocket.Engine.AppError.new("FORBIDDEN", 403, "No permission for #{action} on #{entity}")}
      else
        policies = Registry.get_permissions(registry, entity, action)

        if policies == [] do
          {:error, Rocket.Engine.AppError.new("FORBIDDEN", 403, "No permission for #{action} on #{entity}")}
        else
          check_policies(user, policies, current_record, entity, action)
        end
      end
    end
  end

  @doc "Get row-level read filters for a user on an entity. Returns list of %{field, operator, value}."
  def get_read_filters(user, entity, registry) do
    if user == nil || is_admin?(user) do
      []
    else
      policies = Registry.get_permissions(registry, entity, "read")

      Enum.flat_map(policies, fn p ->
        if has_role_intersection?(user_roles(user), p.roles) do
          (p.conditions || [])
          |> Enum.map(fn cond_map ->
            %{
              field: cond_map["field"] || cond_map[:field],
              operator: cond_map["operator"] || cond_map[:operator] || "eq",
              value: cond_map["value"] || cond_map[:value]
            }
          end)
        else
          []
        end
      end)
    end
  end

  defp check_policies(user, policies, current_record, entity, action) do
    found =
      Enum.any?(policies, fn p ->
        if has_role_intersection?(user_roles(user), p.roles) do
          conditions = p.conditions || []

          if conditions == [] do
            true
          else
            if current_record == nil do
              # For create/read with no current record, allow if roles match
              true
            else
              evaluate_conditions(conditions, current_record)
            end
          end
        else
          false
        end
      end)

    if found do
      :ok
    else
      {:error, Rocket.Engine.AppError.new("FORBIDDEN", 403, "Permission denied for #{action} on #{entity}")}
    end
  end

  defp evaluate_conditions(conditions, record) do
    Enum.all?(conditions, fn cond_map ->
      field = cond_map["field"] || cond_map[:field]
      operator = cond_map["operator"] || cond_map[:operator] || "eq"
      cond_value = cond_map["value"] || cond_map[:value]

      record_val = Map.get(record, field)
      evaluate_condition(operator, record_val, cond_value)
    end)
  end

  defp evaluate_condition("eq", record_val, cond_val) do
    to_string_val(record_val) == to_string_val(cond_val)
  end

  defp evaluate_condition("neq", record_val, cond_val) do
    to_string_val(record_val) != to_string_val(cond_val)
  end

  defp evaluate_condition("in", record_val, cond_val) when is_list(cond_val) do
    sv = to_string_val(record_val)
    Enum.any?(cond_val, fn v -> to_string_val(v) == sv end)
  end

  defp evaluate_condition("not_in", record_val, cond_val) when is_list(cond_val) do
    sv = to_string_val(record_val)
    !Enum.any?(cond_val, fn v -> to_string_val(v) == sv end)
  end

  defp evaluate_condition("gt", record_val, cond_val) do
    compare_numeric(record_val, cond_val, &>/2)
  end

  defp evaluate_condition("gte", record_val, cond_val) do
    compare_numeric(record_val, cond_val, &>=/2)
  end

  defp evaluate_condition("lt", record_val, cond_val) do
    compare_numeric(record_val, cond_val, &</2)
  end

  defp evaluate_condition("lte", record_val, cond_val) do
    compare_numeric(record_val, cond_val, &<=/2)
  end

  defp evaluate_condition(_, _, _), do: false

  defp compare_numeric(a, b, op) do
    af = to_float(a)
    bf = to_float(b)

    if af != nil && bf != nil do
      op.(af, bf)
    else
      false
    end
  end

  defp to_float(val) when is_integer(val), do: val / 1
  defp to_float(val) when is_float(val), do: val

  defp to_float(val) when is_binary(val) do
    case Float.parse(val) do
      {n, _} -> n
      :error -> nil
    end
  end

  defp to_float(_), do: nil

  defp to_string_val(nil), do: ""
  defp to_string_val(val) when is_binary(val), do: val
  defp to_string_val(val), do: "#{val}"

  defp is_admin?(user) do
    roles = user_roles(user)
    "admin" in roles
  end

  defp user_roles(%{roles: roles}) when is_list(roles), do: roles
  defp user_roles(%{"roles" => roles}) when is_list(roles), do: roles
  defp user_roles(_), do: []

  defp has_role_intersection?(user_roles, policy_roles) do
    Enum.any?(user_roles, fn ur ->
      Enum.any?(policy_roles, fn pr ->
        String.downcase(ur) == String.downcase(pr)
      end)
    end)
  end
end
