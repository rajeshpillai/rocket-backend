defmodule Rocket.Engine.Expression do
  @moduledoc "Safe expression interpreter for rules and computed fields."

  # ── Public API ──

  @doc "Evaluate an expression string against an environment map. Returns {:ok, value} or {:error, reason}."
  def evaluate(expression, env) when is_binary(expression) do
    with {:ok, tokens} <- tokenize(expression),
         {:ok, ast} <- parse(tokens) do
      eval(ast, env)
    end
  rescue
    e -> {:error, "expression error: #{inspect(e)}"}
  end

  @doc "Evaluate and expect a boolean result."
  def evaluate_bool(expression, env) do
    case evaluate(expression, env) do
      {:ok, val} when is_boolean(val) -> {:ok, val}
      {:ok, val} -> {:ok, truthy?(val)}
      {:error, _} = err -> err
    end
  end

  # ── Tokenizer ──

  defp tokenize(str), do: tokenize(String.trim(str), [])

  defp tokenize("", acc), do: {:ok, Enum.reverse(acc)}

  # Whitespace
  defp tokenize(<<c, rest::binary>>, acc) when c in ~c[ \t\n\r],
    do: tokenize(rest, acc)

  # Two-character operators
  defp tokenize("==" <> rest, acc), do: tokenize(rest, [{:op, :eq} | acc])
  defp tokenize("!=" <> rest, acc), do: tokenize(rest, [{:op, :neq} | acc])
  defp tokenize(">=" <> rest, acc), do: tokenize(rest, [{:op, :gte} | acc])
  defp tokenize("<=" <> rest, acc), do: tokenize(rest, [{:op, :lte} | acc])
  defp tokenize("&&" <> rest, acc), do: tokenize(rest, [{:op, :and} | acc])
  defp tokenize("||" <> rest, acc), do: tokenize(rest, [{:op, :or} | acc])

  # Single-character operators
  defp tokenize(">" <> rest, acc), do: tokenize(rest, [{:op, :gt} | acc])
  defp tokenize("<" <> rest, acc), do: tokenize(rest, [{:op, :lt} | acc])
  defp tokenize("!" <> rest, acc), do: tokenize(rest, [{:op, :not} | acc])
  defp tokenize("+" <> rest, acc), do: tokenize(rest, [{:op, :add} | acc])
  defp tokenize("-" <> rest, acc), do: tokenize(rest, [{:op, :sub} | acc])
  defp tokenize("*" <> rest, acc), do: tokenize(rest, [{:op, :mul} | acc])
  defp tokenize("/" <> rest, acc), do: tokenize(rest, [{:op, :div} | acc])
  defp tokenize("%" <> rest, acc), do: tokenize(rest, [{:op, :mod} | acc])

  # Delimiters
  defp tokenize("(" <> rest, acc), do: tokenize(rest, [{:lparen, nil} | acc])
  defp tokenize(")" <> rest, acc), do: tokenize(rest, [{:rparen, nil} | acc])
  defp tokenize("[" <> rest, acc), do: tokenize(rest, [{:lbracket, nil} | acc])
  defp tokenize("]" <> rest, acc), do: tokenize(rest, [{:rbracket, nil} | acc])
  defp tokenize("," <> rest, acc), do: tokenize(rest, [{:comma, nil} | acc])
  defp tokenize("." <> rest, acc), do: tokenize(rest, [{:dot, nil} | acc])

  # String literals (single or double quotes)
  defp tokenize("'" <> rest, acc), do: read_string(rest, ?', acc)
  defp tokenize("\"" <> rest, acc), do: read_string(rest, ?", acc)

  # Numbers
  defp tokenize(<<c, _::binary>> = str, acc) when c in ?0..?9 do
    {num, rest} = read_number(str)
    tokenize(rest, [{:number, num} | acc])
  end

  # Identifiers and keywords
  defp tokenize(<<c, _::binary>> = str, acc) when c in ?a..?z or c in ?A..?Z or c == ?_ do
    {word, rest} = read_word(str)

    token =
      case word do
        "true" -> {:bool, true}
        "false" -> {:bool, false}
        "nil" -> {:nil, nil}
        "null" -> {:nil, nil}
        "in" -> {:op, :in}
        "not" -> {:op, :not}
        "and" -> {:op, :and}
        "or" -> {:op, :or}
        _ -> {:ident, word}
      end

    tokenize(rest, [token | acc])
  end

  defp tokenize(str, _acc), do: {:error, "unexpected character: #{String.first(str)}"}

  defp read_string(str, quote, acc) do
    case String.split(str, <<quote>>, parts: 2) do
      [s, rest] -> tokenize(rest, [{:string, s} | acc])
      _ -> {:error, "unterminated string"}
    end
  end

  defp read_number(str) do
    {digits, rest} = consume_while(str, fn c -> c in ?0..?9 end)

    case rest do
      "." <> after_dot ->
        {frac, rest2} = consume_while(after_dot, fn c -> c in ?0..?9 end)

        if frac == "" do
          {parse_number(digits), "." <> rest2}
        else
          {parse_number(digits <> "." <> frac), rest2}
        end

      _ ->
        {parse_number(digits), rest}
    end
  end

  defp parse_number(str) do
    if String.contains?(str, ".") do
      {f, ""} = Float.parse(str)
      f
    else
      {i, ""} = Integer.parse(str)
      i
    end
  end

  defp read_word(str), do: consume_while(str, fn c -> c in ?a..?z or c in ?A..?Z or c in ?0..?9 or c == ?_ end)

  defp consume_while(str, pred) do
    consume_while(str, pred, "")
  end

  defp consume_while("", _pred, acc), do: {acc, ""}

  defp consume_while(<<c, rest::binary>> = str, pred, acc) do
    if pred.(c) do
      consume_while(rest, pred, acc <> <<c>>)
    else
      {acc, str}
    end
  end

  # ── Parser (recursive descent, Pratt-style precedence) ──

  defp parse(tokens) do
    case parse_expr(tokens, 0) do
      {:ok, ast, []} -> {:ok, ast}
      {:ok, ast, _rest} -> {:ok, ast}
      {:error, _} = err -> err
    end
  end

  # Precedence levels
  defp prec(:or), do: 1
  defp prec(:and), do: 2
  defp prec(:eq), do: 3
  defp prec(:neq), do: 3
  defp prec(:lt), do: 4
  defp prec(:gt), do: 4
  defp prec(:lte), do: 4
  defp prec(:gte), do: 4
  defp prec(:in), do: 4
  defp prec(:add), do: 5
  defp prec(:sub), do: 5
  defp prec(:mul), do: 6
  defp prec(:div), do: 6
  defp prec(:mod), do: 6
  defp prec(_), do: 0

  defp parse_expr(tokens, min_prec) do
    with {:ok, lhs, rest} <- parse_unary(tokens) do
      parse_binary(lhs, rest, min_prec)
    end
  end

  defp parse_binary(lhs, [{:op, op} | rest], min_prec) when op in [:eq, :neq, :lt, :gt, :lte, :gte, :add, :sub, :mul, :div, :mod, :and, :or, :in] do
    op_prec = prec(op)

    if op_prec > min_prec do
      with {:ok, rhs, rest2} <- parse_expr(rest, op_prec) do
        parse_binary({:binary, op, lhs, rhs}, rest2, min_prec)
      end
    else
      {:ok, lhs, [{:op, op} | rest]}
    end
  end

  defp parse_binary(lhs, rest, _min_prec), do: {:ok, lhs, rest}

  defp parse_unary([{:op, :not} | rest]) do
    with {:ok, expr, rest2} <- parse_unary(rest) do
      {:ok, {:unary, :not, expr}, rest2}
    end
  end

  defp parse_unary([{:op, :sub} | rest]) do
    with {:ok, expr, rest2} <- parse_unary(rest) do
      {:ok, {:unary, :neg, expr}, rest2}
    end
  end

  defp parse_unary(tokens), do: parse_primary(tokens)

  # Primary expressions
  defp parse_primary([{:number, n} | rest]), do: parse_postfix({:lit, n}, rest)
  defp parse_primary([{:string, s} | rest]), do: parse_postfix({:lit, s}, rest)
  defp parse_primary([{:bool, b} | rest]), do: parse_postfix({:lit, b}, rest)
  defp parse_primary([{:nil, _} | rest]), do: parse_postfix({:lit, nil}, rest)

  # Identifier — could be variable, function call, or property access
  defp parse_primary([{:ident, name} | [{:lparen, _} | _] = rest]) do
    # Function call
    [{:lparen, _} | rest2] = rest

    case parse_args(rest2, []) do
      {:ok, args, rest3} ->
        parse_postfix({:call, name, args}, rest3)

      err ->
        err
    end
  end

  defp parse_primary([{:ident, name} | rest]) do
    parse_postfix({:var, name}, rest)
  end

  # Parenthesized expression
  defp parse_primary([{:lparen, _} | rest]) do
    with {:ok, expr, rest2} <- parse_expr(rest, 0) do
      case rest2 do
        [{:rparen, _} | rest3] -> parse_postfix(expr, rest3)
        _ -> {:error, "expected closing parenthesis"}
      end
    end
  end

  # Array literal
  defp parse_primary([{:lbracket, _} | rest]) do
    case parse_array_items(rest, []) do
      {:ok, items, rest2} -> parse_postfix({:array, items}, rest2)
      err -> err
    end
  end

  defp parse_primary([]), do: {:error, "unexpected end of expression"}
  defp parse_primary([{type, val} | _]), do: {:error, "unexpected token: #{inspect({type, val})}"}

  # Postfix: property access (.field) and array index ([idx])
  defp parse_postfix(expr, [{:dot, _}, {:ident, field} | [{:lparen, _} | _] = rest]) do
    # Method call (not supported but handled gracefully)
    parse_postfix({:access, expr, field}, rest)
  end

  defp parse_postfix(expr, [{:dot, _}, {:ident, field} | rest]) do
    parse_postfix({:access, expr, field}, rest)
  end

  defp parse_postfix(expr, rest), do: {:ok, expr, rest}

  defp parse_args([{:rparen, _} | rest], acc), do: {:ok, Enum.reverse(acc), rest}

  defp parse_args(tokens, acc) do
    with {:ok, expr, rest} <- parse_expr(tokens, 0) do
      case rest do
        [{:comma, _} | rest2] -> parse_args(rest2, [expr | acc])
        [{:rparen, _} | rest2] -> {:ok, Enum.reverse([expr | acc]), rest2}
        _ -> {:error, "expected comma or closing parenthesis in function args"}
      end
    end
  end

  defp parse_array_items([{:rbracket, _} | rest], acc), do: {:ok, Enum.reverse(acc), rest}

  defp parse_array_items(tokens, acc) do
    with {:ok, expr, rest} <- parse_expr(tokens, 0) do
      case rest do
        [{:comma, _} | rest2] -> parse_array_items(rest2, [expr | acc])
        [{:rbracket, _} | rest2] -> {:ok, Enum.reverse([expr | acc]), rest2}
        _ -> {:error, "expected comma or closing bracket in array"}
      end
    end
  end

  # ── Evaluator ──

  defp eval({:lit, val}, _env), do: {:ok, val}

  defp eval({:var, name}, env) do
    {:ok, Map.get(env, name)}
  end

  defp eval({:access, expr, field}, env) do
    with {:ok, obj} <- eval(expr, env) do
      cond do
        is_map(obj) -> {:ok, Map.get(obj, field) || Map.get(obj, String.to_atom(field))}
        true -> {:ok, nil}
      end
    end
  end

  defp eval({:array, items}, env) do
    results = Enum.map(items, fn item -> eval(item, env) end)

    case Enum.find(results, &match?({:error, _}, &1)) do
      nil -> {:ok, Enum.map(results, fn {:ok, v} -> v end)}
      err -> err
    end
  end

  defp eval({:unary, :not, expr}, env) do
    with {:ok, val} <- eval(expr, env) do
      {:ok, !truthy?(val)}
    end
  end

  defp eval({:unary, :neg, expr}, env) do
    with {:ok, val} <- eval(expr, env) do
      {:ok, negate(val)}
    end
  end

  # Binary operators
  defp eval({:binary, :and, lhs, rhs}, env) do
    with {:ok, l} <- eval(lhs, env) do
      if truthy?(l) do
        eval(rhs, env)
      else
        {:ok, false}
      end
    end
  end

  defp eval({:binary, :or, lhs, rhs}, env) do
    with {:ok, l} <- eval(lhs, env) do
      if truthy?(l) do
        {:ok, l}
      else
        eval(rhs, env)
      end
    end
  end

  defp eval({:binary, :in, lhs, rhs}, env) do
    with {:ok, l} <- eval(lhs, env),
         {:ok, r} <- eval(rhs, env) do
      cond do
        is_list(r) -> {:ok, l in r}
        is_binary(r) && is_binary(l) -> {:ok, String.contains?(r, l)}
        true -> {:ok, false}
      end
    end
  end

  defp eval({:binary, op, lhs, rhs}, env) do
    with {:ok, l} <- eval(lhs, env),
         {:ok, r} <- eval(rhs, env) do
      eval_binary_op(op, l, r)
    end
  end

  # Function calls
  defp eval({:call, "len", [arg]}, env) do
    with {:ok, val} <- eval(arg, env) do
      cond do
        is_list(val) -> {:ok, length(val)}
        is_binary(val) -> {:ok, String.length(val)}
        is_map(val) -> {:ok, map_size(val)}
        true -> {:ok, 0}
      end
    end
  end

  defp eval({:call, "abs", [arg]}, env) do
    with {:ok, val} <- eval(arg, env) do
      {:ok, abs(to_number(val))}
    end
  end

  defp eval({:call, "lower", [arg]}, env) do
    with {:ok, val} <- eval(arg, env) do
      {:ok, String.downcase(to_string(val))}
    end
  end

  defp eval({:call, "upper", [arg]}, env) do
    with {:ok, val} <- eval(arg, env) do
      {:ok, String.upcase(to_string(val))}
    end
  end

  defp eval({:call, "trim", [arg]}, env) do
    with {:ok, val} <- eval(arg, env) do
      {:ok, String.trim(to_string(val))}
    end
  end

  defp eval({:call, "contains", [haystack, needle]}, env) do
    with {:ok, h} <- eval(haystack, env),
         {:ok, n} <- eval(needle, env) do
      {:ok, String.contains?(to_string(h), to_string(n))}
    end
  end

  defp eval({:call, "startsWith", [str, prefix]}, env) do
    with {:ok, s} <- eval(str, env),
         {:ok, p} <- eval(prefix, env) do
      {:ok, String.starts_with?(to_string(s), to_string(p))}
    end
  end

  defp eval({:call, "endsWith", [str, suffix]}, env) do
    with {:ok, s} <- eval(str, env),
         {:ok, sf} <- eval(suffix, env) do
      {:ok, String.ends_with?(to_string(s), to_string(sf))}
    end
  end

  defp eval({:call, name, _args}, _env) do
    {:error, "unknown function: #{name}"}
  end

  # Binary operation helpers
  defp eval_binary_op(:eq, l, r), do: {:ok, l == r}
  defp eval_binary_op(:neq, l, r), do: {:ok, l != r}

  defp eval_binary_op(:lt, l, r), do: {:ok, compare(l, r) == :lt}
  defp eval_binary_op(:gt, l, r), do: {:ok, compare(l, r) == :gt}
  defp eval_binary_op(:lte, l, r), do: {:ok, compare(l, r) in [:lt, :eq]}
  defp eval_binary_op(:gte, l, r), do: {:ok, compare(l, r) in [:gt, :eq]}

  defp eval_binary_op(:add, l, r) when is_binary(l) or is_binary(r),
    do: {:ok, to_string(l) <> to_string(r)}

  defp eval_binary_op(:add, l, r), do: {:ok, to_number(l) + to_number(r)}
  defp eval_binary_op(:sub, l, r), do: {:ok, to_number(l) - to_number(r)}
  defp eval_binary_op(:mul, l, r), do: {:ok, to_number(l) * to_number(r)}

  defp eval_binary_op(:div, _l, r) when r == 0, do: {:error, "division by zero"}
  defp eval_binary_op(:div, l, r), do: {:ok, to_number(l) / to_number(r)}

  defp eval_binary_op(:mod, _l, r) when r == 0, do: {:error, "modulo by zero"}
  defp eval_binary_op(:mod, l, r), do: {:ok, rem(trunc(to_number(l)), trunc(to_number(r)))}

  # ── Helpers ──

  defp truthy?(nil), do: false
  defp truthy?(false), do: false
  defp truthy?(0), do: false
  defp truthy?(+0.0), do: false
  defp truthy?(""), do: false
  defp truthy?([]), do: false
  defp truthy?(_), do: true

  defp negate(n) when is_number(n), do: -n
  defp negate(_), do: 0

  defp to_number(n) when is_integer(n), do: n
  defp to_number(n) when is_float(n), do: n
  defp to_number(true), do: 1
  defp to_number(false), do: 0
  defp to_number(nil), do: 0

  defp to_number(s) when is_binary(s) do
    case Float.parse(s) do
      {n, ""} -> n
      _ -> 0
    end
  end

  defp to_number(_), do: 0

  defp compare(l, r) when is_number(l) and is_number(r) do
    cond do
      l < r -> :lt
      l > r -> :gt
      true -> :eq
    end
  end

  defp compare(l, r) when is_binary(l) and is_binary(r) do
    cond do
      l < r -> :lt
      l > r -> :gt
      true -> :eq
    end
  end

  defp compare(nil, nil), do: :eq
  defp compare(nil, _), do: :lt
  defp compare(_, nil), do: :gt

  defp compare(l, r) do
    nl = to_number(l)
    nr = to_number(r)

    cond do
      nl < nr -> :lt
      nl > nr -> :gt
      true -> :eq
    end
  end
end
