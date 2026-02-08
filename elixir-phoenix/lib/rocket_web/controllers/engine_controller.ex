defmodule RocketWeb.EngineController do
  @moduledoc "Dynamic REST controller — 5 CRUD endpoints per entity."
  use RocketWeb, :controller

  alias Rocket.Store.Postgres
  alias Rocket.Metadata.Registry
  alias Rocket.Engine.{Query, NestedWrite, Includes, SoftDelete, AppError}
  alias Rocket.Auth.Permissions

  # GET /api/:entity
  def list(conn, %{"entity" => entity_name} = params) do
    registry = get_registry(conn)
    user = conn.assigns[:current_user]

    with {:ok, entity} <- resolve_entity(registry, entity_name),
         :ok <- check_perm(user, entity_name, "read", registry),
         {:ok, plan} <- Query.parse_query_params(params, entity, registry) do
      db = get_conn(conn)

      # Inject row-level security filters
      read_filters = Permissions.get_read_filters(user, entity_name, registry)

      extra_filters =
        Enum.map(read_filters, fn f ->
          %{field: f.field, operator: f.operator || "eq", value: f.value}
        end)

      plan = %{plan | filters: plan.filters ++ extra_filters}

      qr = Query.build_select_sql(plan)
      cr = Query.build_count_sql(plan)

      with {:ok, rows} <- Postgres.query_rows(db, qr.sql, qr.params),
           {:ok, count_row} <- Postgres.query_row(db, cr.sql, cr.params) do
        total = count_row["count"] || 0

        {:ok, rows} =
          if plan.includes != [] do
            Includes.load_includes(db, registry, entity, rows, plan.includes)
          else
            {:ok, rows}
          end

        rows = rows || []

        json(conn, %{
          data: rows,
          meta: %{page: plan.page, per_page: plan.per_page, total: total}
        })
      else
        {:error, err} -> respond_error(conn, wrap_error(err))
      end
    else
      {:error, %AppError{} = err} -> respond_error(conn, err)
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  # GET /api/:entity/:id
  def get(conn, %{"entity" => entity_name, "id" => id} = params) do
    registry = get_registry(conn)
    user = conn.assigns[:current_user]

    with {:ok, entity} <- resolve_entity(registry, entity_name),
         :ok <- check_perm(user, entity_name, "read", registry) do
      db = get_conn(conn)

      case NestedWrite.fetch_record(db, entity, id) do
        {:ok, row} ->
          includes = parse_includes(params)

          {:ok, rows} =
            if includes != [] do
              Includes.load_includes(db, registry, entity, [row], includes)
            else
              {:ok, [row]}
            end

          json(conn, %{data: hd(rows)})

        {:error, :not_found} ->
          respond_error(conn, AppError.not_found(entity_name, id))

        {:error, err} ->
          respond_error(conn, wrap_error(err))
      end
    else
      {:error, %AppError{} = err} -> respond_error(conn, err)
    end
  end

  # POST /api/:entity
  def create(conn, %{"entity" => entity_name} = params) do
    registry = get_registry(conn)
    user = conn.assigns[:current_user]

    with {:ok, entity} <- resolve_entity(registry, entity_name),
         :ok <- check_perm(user, entity_name, "create", registry) do
      body = Map.drop(params, ["entity"])
      db = get_conn(conn)

      case NestedWrite.plan_write(entity, registry, body, nil) do
        {:ok, plan} ->
          case NestedWrite.execute_and_fetch(db, registry, plan) do
            {:ok, record} ->
              conn
              |> put_status(201)
              |> json(%{data: record})

            {:error, err} ->
              respond_error(conn, handle_write_error(err))
          end

        {:error, %AppError{} = err} ->
          respond_error(conn, err)
      end
    else
      {:error, %AppError{} = err} -> respond_error(conn, err)
    end
  end

  # PUT /api/:entity/:id
  def update(conn, %{"entity" => entity_name, "id" => id} = params) do
    registry = get_registry(conn)
    user = conn.assigns[:current_user]

    with {:ok, entity} <- resolve_entity(registry, entity_name) do
      db = get_conn(conn)

      case NestedWrite.fetch_record(db, entity, id) do
        {:ok, existing} ->
          with :ok <- check_perm(user, entity_name, "update", registry, existing) do
            body = Map.drop(params, ["entity", "id"])

            case NestedWrite.plan_write(entity, registry, body, id) do
              {:ok, plan} ->
                case NestedWrite.execute_and_fetch(db, registry, plan) do
                  {:ok, record} ->
                    json(conn, %{data: record})

                  {:error, err} ->
                    respond_error(conn, handle_write_error(err))
                end

              {:error, %AppError{} = err} ->
                respond_error(conn, err)
            end
          else
            {:error, %AppError{} = err} -> respond_error(conn, err)
          end

        {:error, :not_found} ->
          respond_error(conn, AppError.not_found(entity_name, id))

        {:error, err} ->
          respond_error(conn, wrap_error(err))
      end
    else
      {:error, %AppError{} = err} -> respond_error(conn, err)
    end
  end

  # DELETE /api/:entity/:id
  def delete(conn, %{"entity" => entity_name, "id" => id}) do
    registry = get_registry(conn)
    user = conn.assigns[:current_user]

    with {:ok, entity} <- resolve_entity(registry, entity_name) do
      db = get_conn(conn)

      case NestedWrite.fetch_record(db, entity, id) do
        {:ok, existing} ->
          with :ok <- check_perm(user, entity_name, "delete", registry, existing) do
            # Handle cascade deletes
            case SoftDelete.handle_cascade_delete(db, registry, entity, id) do
              :ok ->
                {sql, params} =
                  if entity.soft_delete do
                    SoftDelete.build_soft_delete_sql(entity, id)
                  else
                    SoftDelete.build_hard_delete_sql(entity, id)
                  end

                case Postgres.exec(db, sql, params) do
                  {:ok, n} when n > 0 ->
                    json(conn, %{data: %{id: id}})

                  {:ok, _} ->
                    respond_error(conn, AppError.not_found(entity_name, id))

                  {:error, err} ->
                    respond_error(conn, wrap_error(err))
                end

              {:error, %AppError{} = err} ->
                respond_error(conn, err)

              {:error, err} ->
                respond_error(conn, wrap_error(err))
            end
          else
            {:error, %AppError{} = err} -> respond_error(conn, err)
          end

        {:error, :not_found} ->
          respond_error(conn, AppError.not_found(entity_name, id))

        {:error, err} ->
          respond_error(conn, wrap_error(err))
      end
    else
      {:error, %AppError{} = err} -> respond_error(conn, err)
    end
  end

  # ── Helpers ──

  defp resolve_entity(registry, name) do
    case Registry.get_entity(registry, name) do
      nil -> {:error, AppError.unknown_entity(name)}
      entity -> {:ok, entity}
    end
  end

  defp check_perm(user, entity, action, registry, current_record \\ nil) do
    Permissions.check_permission(user, entity, action, registry, current_record)
  end

  defp get_registry(conn) do
    conn.assigns[:registry] || Rocket.Metadata.Registry
  end

  defp get_conn(conn) do
    conn.assigns[:db_conn] || Rocket.Repo
  end

  defp parse_includes(params) do
    case Map.get(params, "include", "") do
      "" ->
        []

      inc ->
        inc
        |> String.split(",")
        |> Enum.map(&String.trim/1)
        |> Enum.reject(&(&1 == ""))
    end
  end

  defp respond_error(conn, %AppError{} = err) do
    conn
    |> put_status(err.status)
    |> json(%{error: AppError.to_json(err)})
  end

  defp handle_write_error(%AppError{} = err), do: err

  defp handle_write_error({:unique_violation, _}) do
    AppError.conflict("A record with this value already exists")
  end

  defp handle_write_error(err) do
    AppError.new("INTERNAL_ERROR", 500, "Write failed: #{inspect(err)}")
  end

  defp wrap_error(%AppError{} = err), do: err

  defp wrap_error(err) do
    AppError.new("INTERNAL_ERROR", 500, "#{inspect(err)}")
  end
end
