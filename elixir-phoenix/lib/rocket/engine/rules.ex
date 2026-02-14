defmodule Rocket.Engine.Rules do
  @moduledoc "Validation rules engine: field rules, expression rules, computed fields."

  alias Rocket.Metadata.Registry
  alias Rocket.Engine.Expression
  alias Rocket.Instrument.Instrumenter

  @doc "Evaluate all rules for an entity/hook. Returns [] on success or [%{field, rule, message}] on failure."
  def evaluate_rules(registry, entity_name, hook, fields, old, action) do
    span = Instrumenter.start_span("engine", "rules", "rule.evaluate")
    span = Instrumenter.set_entity(span, entity_name)

    try do
      result = do_evaluate_rules(registry, entity_name, hook, fields, old, action)

      _span = case result do
        [] -> Instrumenter.set_status(span, "ok")
        _ -> Instrumenter.set_status(span, "error")
      end

      result
    catch
      kind, err ->
        _span = Instrumenter.set_status(span, "error")
        :erlang.raise(kind, err, __STACKTRACE__)
    after
      Instrumenter.end_span(span)
    end
  end

  defp do_evaluate_rules(registry, entity_name, hook, fields, old, action) do
    rules = Registry.get_rules_for_entity(registry, entity_name, hook)

    env = %{
      "record" => fields || %{},
      "old" => old || %{},
      "action" => action
    }

    # Layer 1: Field rules
    field_rules = Enum.filter(rules, &(&1.type == "field"))
    {errs, halted?} = evaluate_rule_batch(field_rules, fn rule -> evaluate_field_rule(rule, fields) end)

    if halted? do
      errs
    else
      # Layer 2: Expression rules
      expr_rules = Enum.filter(rules, &(&1.type == "expression"))
      {expr_errs, halted?} = evaluate_rule_batch(expr_rules, fn rule -> evaluate_expression_rule(rule, env) end)
      errs = errs ++ expr_errs

      if halted? || errs != [] do
        errs
      else
        # Layer 3: Computed fields (only if no validation errors)
        computed_rules = Enum.filter(rules, &(&1.type == "computed"))
        computed_errs = evaluate_computed_fields(computed_rules, fields, env)
        computed_errs
      end
    end
  end

  defp evaluate_rule_batch(rules, eval_fn) do
    Enum.reduce_while(rules, {[], false}, fn rule, {errs, _halted} ->
      case eval_fn.(rule) do
        nil ->
          {:cont, {errs, false}}

        err ->
          if rule.definition && rule.definition.stop_on_fail do
            {:halt, {errs ++ [err], true}}
          else
            {:cont, {errs ++ [err], false}}
          end
      end
    end)
  end

  # ── Field Rules ──

  defp evaluate_field_rule(rule, fields) do
    defn = rule.definition
    field = defn.field
    val = Map.get(fields, field)

    # Field rules skip nil/absent fields
    if val == nil do
      nil
    else
      op = defn.operator
      threshold = defn.value
      msg = defn.message

      case op do
        "min" -> check_min(field, val, threshold, msg)
        "max" -> check_max(field, val, threshold, msg)
        "min_length" -> check_min_length(field, val, threshold, msg)
        "max_length" -> check_max_length(field, val, threshold, msg)
        "pattern" -> check_pattern(field, val, threshold, msg)
        _ -> nil
      end
    end
  end

  defp check_min(field, val, threshold, msg) do
    num = to_float(val)
    thr = to_float(threshold)

    if num != nil && thr != nil && num < thr do
      %{field: field, rule: "min", message: msg || "#{field} must be at least #{threshold}"}
    else
      nil
    end
  end

  defp check_max(field, val, threshold, msg) do
    num = to_float(val)
    thr = to_float(threshold)

    if num != nil && thr != nil && num > thr do
      %{field: field, rule: "max", message: msg || "#{field} must be at most #{threshold}"}
    else
      nil
    end
  end

  defp check_min_length(field, val, threshold, msg) when is_binary(val) do
    thr = to_float(threshold) || 0

    if String.length(val) < trunc(thr) do
      %{field: field, rule: "min_length", message: msg || "#{field} must be at least #{trunc(thr)} characters"}
    else
      nil
    end
  end

  defp check_min_length(_, _, _, _), do: nil

  defp check_max_length(field, val, threshold, msg) when is_binary(val) do
    thr = to_float(threshold) || 0

    if String.length(val) > trunc(thr) do
      %{field: field, rule: "max_length", message: msg || "#{field} must be at most #{trunc(thr)} characters"}
    else
      nil
    end
  end

  defp check_max_length(_, _, _, _), do: nil

  defp check_pattern(field, val, pattern, msg) when is_binary(val) and is_binary(pattern) do
    case Regex.compile(pattern) do
      {:ok, re} ->
        if Regex.match?(re, val), do: nil, else: %{field: field, rule: "pattern", message: msg || "#{field} does not match pattern #{pattern}"}

      {:error, _} ->
        %{field: field, rule: "pattern", message: "Invalid regex pattern: #{pattern}"}
    end
  end

  defp check_pattern(_, _, _, _), do: nil

  # ── Expression Rules ──

  defp evaluate_expression_rule(rule, env) do
    defn = rule.definition
    expression = defn.expression

    if !expression || expression == "" do
      nil
    else
      case Expression.evaluate_bool(expression, env) do
        {:ok, true} ->
          # Expression returned true = rule violated
          msg = defn.message || "Expression rule violated"
          field = defn.field || ""
          %{field: field, rule: "expression", message: msg}

        {:ok, false} ->
          nil

        {:error, err} ->
          %{field: defn.field || "", rule: "expression", message: "Expression error: #{err}"}
      end
    end
  end

  # ── Computed Fields ──

  defp evaluate_computed_fields(rules, fields, env) do
    Enum.reduce(rules, [], fn rule, errs ->
      defn = rule.definition
      field = defn.field
      expression = defn.expression

      if !field || field == "" || !expression || expression == "" do
        errs
      else
        case Expression.evaluate(expression, env) do
          {:ok, value} ->
            # Mutate fields map with computed value
            Map.put(fields, field, value)
            errs

          {:error, err} ->
            errs ++ [%{field: field, rule: "computed", message: "Computed field error: #{err}"}]
        end
      end
    end)
  end

  # ── Helpers ──

  defp to_float(val) when is_integer(val), do: val / 1
  defp to_float(val) when is_float(val), do: val

  defp to_float(val) when is_binary(val) do
    case Float.parse(val) do
      {n, ""} -> n
      _ -> nil
    end
  end

  defp to_float(_), do: nil
end
