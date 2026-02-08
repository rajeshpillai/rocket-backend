defmodule RocketWeb.AdminController do
  @moduledoc "Admin API controller — entity, relation, and metadata CRUD."
  use RocketWeb, :controller

  alias Rocket.Store.{Postgres, Migrator}
  alias Rocket.Metadata.{Entity, Relation, Registry, Loader}
  alias Rocket.Engine.AppError

  # ── Entities ──

  def list_entities(conn, _params) do
    db = get_conn(conn)

    case Postgres.query_rows(db, "SELECT name, table_name, definition, created_at, updated_at FROM _entities ORDER BY name") do
      {:ok, rows} -> json(conn, %{data: rows})
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def get_entity(conn, %{"name" => name}) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT name, table_name, definition, created_at, updated_at FROM _entities WHERE name = $1", [name]) do
      {:ok, row} -> json(conn, %{data: row})
      {:error, :not_found} -> respond_error(conn, AppError.not_found("Entity", name))
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def create_entity(conn, params) do
    with {:ok, entity} <- parse_entity(params),
         :ok <- validate_entity(entity),
         :ok <- check_entity_not_exists(conn, entity.name) do
      db = get_conn(conn)
      definition = entity_to_definition(entity)

      case Postgres.exec(db,
             "INSERT INTO _entities (name, table_name, definition) VALUES ($1, $2, $3)",
             [entity.name, entity.table, definition]) do
        {:ok, _} ->
          Migrator.migrate(db, entity)
          reload_registry(conn)

          case Postgres.query_row(db, "SELECT name, table_name, definition, created_at, updated_at FROM _entities WHERE name = $1", [entity.name]) do
            {:ok, row} ->
              conn |> put_status(201) |> json(%{data: row})

            {:error, _} ->
              conn |> put_status(201) |> json(%{data: %{name: entity.name}})
          end

        {:error, {:unique_violation, _}} ->
          respond_error(conn, AppError.conflict("Entity '#{entity.name}' already exists"))

        {:error, err} ->
          respond_error(conn, wrap_error(err))
      end
    else
      {:error, %AppError{} = err} -> respond_error(conn, err)
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def update_entity(conn, %{"name" => name} = params) do
    with {:ok, entity} <- parse_entity(Map.put(params, "name", name)),
         :ok <- validate_entity(entity),
         :ok <- check_entity_exists(conn, name) do
      db = get_conn(conn)
      definition = entity_to_definition(entity)

      case Postgres.exec(db,
             "UPDATE _entities SET table_name = $1, definition = $2, updated_at = NOW() WHERE name = $3",
             [entity.table, definition, name]) do
        {:ok, _} ->
          Migrator.migrate(db, entity)
          reload_registry(conn)

          case Postgres.query_row(db, "SELECT name, table_name, definition, created_at, updated_at FROM _entities WHERE name = $1", [name]) do
            {:ok, row} -> json(conn, %{data: row})
            {:error, _} -> json(conn, %{data: %{name: name}})
          end

        {:error, err} ->
          respond_error(conn, wrap_error(err))
      end
    else
      {:error, %AppError{} = err} -> respond_error(conn, err)
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def delete_entity(conn, %{"name" => name}) do
    db = get_conn(conn)

    with :ok <- check_entity_exists(conn, name) do
      Postgres.exec(db, "DELETE FROM _relations WHERE source = $1 OR target = $1", [name])
      Postgres.exec(db, "DELETE FROM _entities WHERE name = $1", [name])
      reload_registry(conn)
      json(conn, %{data: %{name: name, deleted: true}})
    else
      {:error, %AppError{} = err} -> respond_error(conn, err)
    end
  end

  # ── Relations ──

  def list_relations(conn, _params) do
    db = get_conn(conn)

    case Postgres.query_rows(db, "SELECT name, source, target, definition, created_at, updated_at FROM _relations ORDER BY name") do
      {:ok, rows} -> json(conn, %{data: rows})
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def get_relation(conn, %{"name" => name}) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT name, source, target, definition, created_at, updated_at FROM _relations WHERE name = $1", [name]) do
      {:ok, row} -> json(conn, %{data: row})
      {:error, :not_found} -> respond_error(conn, AppError.not_found("Relation", name))
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def create_relation(conn, params) do
    with {:ok, rel} <- parse_relation(params),
         :ok <- validate_relation(conn, rel) do
      db = get_conn(conn)
      definition = relation_to_definition(rel)

      case Postgres.exec(db,
             "INSERT INTO _relations (name, source, target, definition) VALUES ($1, $2, $3, $4)",
             [rel.name, rel.source, rel.target, definition]) do
        {:ok, _} ->
          if Relation.many_to_many?(rel) do
            registry = get_registry(conn)
            source_entity = Registry.get_entity(registry, rel.source)
            target_entity = Registry.get_entity(registry, rel.target)

            if source_entity && target_entity do
              Migrator.migrate_join_table(db, rel, source_entity, target_entity)
            end
          end

          reload_registry(conn)

          case Postgres.query_row(db, "SELECT name, source, target, definition, created_at, updated_at FROM _relations WHERE name = $1", [rel.name]) do
            {:ok, row} -> conn |> put_status(201) |> json(%{data: row})
            {:error, _} -> conn |> put_status(201) |> json(%{data: %{name: rel.name}})
          end

        {:error, {:unique_violation, _}} ->
          respond_error(conn, AppError.conflict("Relation '#{rel.name}' already exists"))

        {:error, err} ->
          respond_error(conn, wrap_error(err))
      end
    else
      {:error, %AppError{} = err} -> respond_error(conn, err)
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def update_relation(conn, %{"name" => name} = params) do
    with {:ok, rel} <- parse_relation(Map.put(params, "name", name)),
         :ok <- validate_relation(conn, rel) do
      db = get_conn(conn)
      definition = relation_to_definition(rel)

      case Postgres.exec(db,
             "UPDATE _relations SET source = $1, target = $2, definition = $3, updated_at = NOW() WHERE name = $4",
             [rel.source, rel.target, definition, name]) do
        {:ok, _} ->
          reload_registry(conn)

          case Postgres.query_row(db, "SELECT name, source, target, definition, created_at, updated_at FROM _relations WHERE name = $1", [name]) do
            {:ok, row} -> json(conn, %{data: row})
            {:error, _} -> json(conn, %{data: %{name: name}})
          end

        {:error, err} ->
          respond_error(conn, wrap_error(err))
      end
    else
      {:error, %AppError{} = err} -> respond_error(conn, err)
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def delete_relation(conn, %{"name" => name}) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT name FROM _relations WHERE name = $1", [name]) do
      {:ok, _} ->
        Postgres.exec(db, "DELETE FROM _relations WHERE name = $1", [name])
        reload_registry(conn)
        json(conn, %{data: %{name: name, deleted: true}})

      {:error, :not_found} ->
        respond_error(conn, AppError.not_found("Relation", name))

      {:error, err} ->
        respond_error(conn, wrap_error(err))
    end
  end

  # ── Rules ──

  def list_rules(conn, _params) do
    db = get_conn(conn)

    case Postgres.query_rows(db, "SELECT id, entity, hook, type, definition, priority, active, created_at, updated_at FROM _rules ORDER BY entity, priority") do
      {:ok, rows} -> json(conn, %{data: rows})
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def get_rule(conn, %{"id" => id}) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id, entity, hook, type, definition, priority, active, created_at, updated_at FROM _rules WHERE id = $1", [id]) do
      {:ok, row} -> json(conn, %{data: row})
      {:error, :not_found} -> respond_error(conn, AppError.not_found("Rule", id))
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def create_rule(conn, params) do
    with :ok <- validate_rule(conn, params) do
      db = get_conn(conn)
      definition = params["definition"] || %{}
      entity = params["entity"]
      hook = params["hook"] || "before_write"
      type = params["type"]
      priority = params["priority"] || 0
      active = if(params["active"] == nil, do: true, else: params["active"])

      case Postgres.query_row(db,
             "INSERT INTO _rules (entity, hook, type, definition, priority, active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, entity, hook, type, definition, priority, active, created_at, updated_at",
             [entity, hook, type, definition, priority, active]) do
        {:ok, row} ->
          reload_registry(conn)
          conn |> put_status(201) |> json(%{data: row})

        {:error, err} ->
          respond_error(conn, wrap_error(err))
      end
    else
      {:error, %AppError{} = err} -> respond_error(conn, err)
    end
  end

  def update_rule(conn, %{"id" => id} = params) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id FROM _rules WHERE id = $1", [id]) do
      {:ok, _} ->
        sets = []
        prms = []
        n = 0

        {sets, prms, n} =
          if params["entity"] do
            n = n + 1
            {sets ++ ["entity = $#{n}"], prms ++ [params["entity"]], n}
          else
            {sets, prms, n}
          end

        {sets, prms, n} =
          if params["hook"] do
            n = n + 1
            {sets ++ ["hook = $#{n}"], prms ++ [params["hook"]], n}
          else
            {sets, prms, n}
          end

        {sets, prms, n} =
          if params["type"] do
            n = n + 1
            {sets ++ ["type = $#{n}"], prms ++ [params["type"]], n}
          else
            {sets, prms, n}
          end

        {sets, prms, n} =
          if params["definition"] do
            n = n + 1
            {sets ++ ["definition = $#{n}"], prms ++ [params["definition"]], n}
          else
            {sets, prms, n}
          end

        {sets, prms, n} =
          if params["priority"] != nil do
            n = n + 1
            {sets ++ ["priority = $#{n}"], prms ++ [params["priority"]], n}
          else
            {sets, prms, n}
          end

        {sets, prms, n} =
          if params["active"] != nil do
            n = n + 1
            {sets ++ ["active = $#{n}"], prms ++ [params["active"]], n}
          else
            {sets, prms, n}
          end

        if sets == [] do
          case Postgres.query_row(db, "SELECT id, entity, hook, type, definition, priority, active, created_at, updated_at FROM _rules WHERE id = $1", [id]) do
            {:ok, row} -> json(conn, %{data: row})
            {:error, err} -> respond_error(conn, wrap_error(err))
          end
        else
          sets = sets ++ ["updated_at = NOW()"]
          n = n + 1
          prms = prms ++ [id]

          case Postgres.exec(db, "UPDATE _rules SET #{Enum.join(sets, ", ")} WHERE id = $#{n}", prms) do
            {:ok, _} ->
              reload_registry(conn)

              case Postgres.query_row(db, "SELECT id, entity, hook, type, definition, priority, active, created_at, updated_at FROM _rules WHERE id = $1", [id]) do
                {:ok, row} -> json(conn, %{data: row})
                {:error, err} -> respond_error(conn, wrap_error(err))
              end

            {:error, err} ->
              respond_error(conn, wrap_error(err))
          end
        end

      {:error, :not_found} ->
        respond_error(conn, AppError.not_found("Rule", id))

      {:error, err} ->
        respond_error(conn, wrap_error(err))
    end
  end

  def delete_rule(conn, %{"id" => id}) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id FROM _rules WHERE id = $1", [id]) do
      {:ok, _} ->
        Postgres.exec(db, "DELETE FROM _rules WHERE id = $1", [id])
        reload_registry(conn)
        json(conn, %{data: %{id: id, deleted: true}})

      {:error, :not_found} ->
        respond_error(conn, AppError.not_found("Rule", id))

      {:error, err} ->
        respond_error(conn, wrap_error(err))
    end
  end

  # ── State Machines ──

  def list_state_machines(conn, _params) do
    db = get_conn(conn)

    case Postgres.query_rows(db, "SELECT id, entity, field, definition, active, created_at, updated_at FROM _state_machines ORDER BY entity") do
      {:ok, rows} -> json(conn, %{data: rows})
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def get_state_machine(conn, %{"id" => id}) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id, entity, field, definition, active, created_at, updated_at FROM _state_machines WHERE id = $1", [id]) do
      {:ok, row} -> json(conn, %{data: row})
      {:error, :not_found} -> respond_error(conn, AppError.not_found("StateMachine", id))
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def create_state_machine(conn, params) do
    with :ok <- validate_state_machine(conn, params) do
      db = get_conn(conn)
      definition = params["definition"] || %{}
      entity = params["entity"]
      field = params["field"]
      active = if(params["active"] == nil, do: true, else: params["active"])

      case Postgres.query_row(db,
             "INSERT INTO _state_machines (entity, field, definition, active) VALUES ($1, $2, $3, $4) RETURNING id, entity, field, definition, active, created_at, updated_at",
             [entity, field, definition, active]) do
        {:ok, row} ->
          reload_registry(conn)
          conn |> put_status(201) |> json(%{data: row})

        {:error, err} ->
          respond_error(conn, wrap_error(err))
      end
    else
      {:error, %AppError{} = err} -> respond_error(conn, err)
    end
  end

  def update_state_machine(conn, %{"id" => id} = params) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id FROM _state_machines WHERE id = $1", [id]) do
      {:ok, _} ->
        {sets, prms, n} = build_update_sets(params, [
          {"entity", "entity"},
          {"field", "field"},
          {"active", "active"}
        ])

        {sets, prms, n} =
          if params["definition"] do
            n = n + 1
            {sets ++ ["definition = $#{n}"], prms ++ [params["definition"]], n}
          else
            {sets, prms, n}
          end

        if sets == [] do
          fetch_and_return_state_machine(conn, db, id)
        else
          sets = sets ++ ["updated_at = NOW()"]
          n = n + 1
          prms = prms ++ [id]
          Postgres.exec(db, "UPDATE _state_machines SET #{Enum.join(sets, ", ")} WHERE id = $#{n}", prms)
          reload_registry(conn)
          fetch_and_return_state_machine(conn, db, id)
        end

      {:error, :not_found} ->
        respond_error(conn, AppError.not_found("StateMachine", id))

      {:error, err} ->
        respond_error(conn, wrap_error(err))
    end
  end

  def delete_state_machine(conn, %{"id" => id}) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id FROM _state_machines WHERE id = $1", [id]) do
      {:ok, _} ->
        Postgres.exec(db, "DELETE FROM _state_machines WHERE id = $1", [id])
        reload_registry(conn)
        json(conn, %{data: %{id: id, deleted: true}})

      {:error, :not_found} ->
        respond_error(conn, AppError.not_found("StateMachine", id))

      {:error, err} ->
        respond_error(conn, wrap_error(err))
    end
  end

  # ── Workflows ──

  def list_workflows(conn, _params) do
    db = get_conn(conn)

    case Postgres.query_rows(db, "SELECT id, name, trigger, context, steps, active, created_at, updated_at FROM _workflows ORDER BY name") do
      {:ok, rows} -> json(conn, %{data: rows})
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def get_workflow(conn, %{"id" => id}) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id, name, trigger, context, steps, active, created_at, updated_at FROM _workflows WHERE id = $1", [id]) do
      {:ok, row} -> json(conn, %{data: row})
      {:error, :not_found} -> respond_error(conn, AppError.not_found("Workflow", id))
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def create_workflow(conn, params) do
    with :ok <- validate_workflow(params) do
      db = get_conn(conn)
      name = params["name"]
      trigger = params["trigger"] || %{}
      context = params["context"] || %{}
      steps = params["steps"] || []
      active = if(params["active"] == nil, do: true, else: params["active"])

      case Postgres.query_row(db,
             "INSERT INTO _workflows (name, trigger, context, steps, active) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, trigger, context, steps, active, created_at, updated_at",
             [name, trigger, context, steps, active]) do
        {:ok, row} ->
          reload_registry(conn)
          conn |> put_status(201) |> json(%{data: row})

        {:error, {:unique_violation, _}} ->
          respond_error(conn, AppError.conflict("Workflow '#{name}' already exists"))

        {:error, err} ->
          respond_error(conn, wrap_error(err))
      end
    else
      {:error, %AppError{} = err} -> respond_error(conn, err)
    end
  end

  def update_workflow(conn, %{"id" => id} = params) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id FROM _workflows WHERE id = $1", [id]) do
      {:ok, _} ->
        {sets, prms, n} = build_update_sets(params, [{"name", "name"}, {"active", "active"}])

        {sets, prms, n} = add_jsonb_set(sets, prms, n, params, "trigger")
        {sets, prms, n} = add_jsonb_set(sets, prms, n, params, "context")
        {sets, prms, n} = add_jsonb_set(sets, prms, n, params, "steps")

        if sets == [] do
          fetch_and_return_workflow(conn, db, id)
        else
          sets = sets ++ ["updated_at = NOW()"]
          n = n + 1
          prms = prms ++ [id]
          Postgres.exec(db, "UPDATE _workflows SET #{Enum.join(sets, ", ")} WHERE id = $#{n}", prms)
          reload_registry(conn)
          fetch_and_return_workflow(conn, db, id)
        end

      {:error, :not_found} ->
        respond_error(conn, AppError.not_found("Workflow", id))

      {:error, err} ->
        respond_error(conn, wrap_error(err))
    end
  end

  def delete_workflow(conn, %{"id" => id}) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id FROM _workflows WHERE id = $1", [id]) do
      {:ok, _} ->
        Postgres.exec(db, "DELETE FROM _workflows WHERE id = $1", [id])
        reload_registry(conn)
        json(conn, %{data: %{id: id, deleted: true}})

      {:error, :not_found} ->
        respond_error(conn, AppError.not_found("Workflow", id))

      {:error, err} ->
        respond_error(conn, wrap_error(err))
    end
  end

  # ── Users ──

  def list_users(conn, _params) do
    db = get_conn(conn)

    case Postgres.query_rows(db, "SELECT id, email, roles, active, created_at, updated_at FROM _users ORDER BY email") do
      {:ok, rows} -> json(conn, %{data: rows})
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def get_user(conn, %{"id" => id}) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id, email, roles, active, created_at, updated_at FROM _users WHERE id = $1", [id]) do
      {:ok, row} -> json(conn, %{data: row})
      {:error, :not_found} -> respond_error(conn, AppError.not_found("User", id))
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def create_user(conn, params) do
    email = params["email"]
    password = params["password"]

    errs = []
    errs = if(!email || email == "", do: errs ++ [%{field: "email", rule: "required", message: "email is required"}], else: errs)
    errs = if(!password || password == "", do: errs ++ [%{field: "password", rule: "required", message: "password is required"}], else: errs)

    if errs != [] do
      respond_error(conn, AppError.validation_failed(errs))
    else
      db = get_conn(conn)
      hash = Bcrypt.hash_pwd_salt(password)
      roles = params["roles"] || []
      active = if(params["active"] == nil, do: true, else: params["active"])

      case Postgres.query_row(db,
             "INSERT INTO _users (email, password_hash, roles, active) VALUES ($1, $2, $3, $4) RETURNING id, email, roles, active, created_at, updated_at",
             [email, hash, roles, active]) do
        {:ok, row} ->
          conn |> put_status(201) |> json(%{data: row})

        {:error, {:unique_violation, _}} ->
          respond_error(conn, AppError.conflict("User with email '#{email}' already exists"))

        {:error, err} ->
          respond_error(conn, wrap_error(err))
      end
    end
  end

  def update_user(conn, %{"id" => id} = params) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id FROM _users WHERE id = $1", [id]) do
      {:ok, _} ->
        {sets, prms, n} = build_update_sets(params, [{"email", "email"}, {"active", "active"}])

        {sets, prms, n} =
          if params["roles"] do
            n = n + 1
            {sets ++ ["roles = $#{n}"], prms ++ [params["roles"]], n}
          else
            {sets, prms, n}
          end

        {sets, prms, n} =
          if params["password"] && params["password"] != "" do
            hash = Bcrypt.hash_pwd_salt(params["password"])
            n = n + 1
            {sets ++ ["password_hash = $#{n}"], prms ++ [hash], n}
          else
            {sets, prms, n}
          end

        if sets == [] do
          fetch_and_return_user(conn, db, id)
        else
          sets = sets ++ ["updated_at = NOW()"]
          n = n + 1
          prms = prms ++ [id]
          Postgres.exec(db, "UPDATE _users SET #{Enum.join(sets, ", ")} WHERE id = $#{n}", prms)
          fetch_and_return_user(conn, db, id)
        end

      {:error, :not_found} ->
        respond_error(conn, AppError.not_found("User", id))

      {:error, err} ->
        respond_error(conn, wrap_error(err))
    end
  end

  def delete_user(conn, %{"id" => id}) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id FROM _users WHERE id = $1", [id]) do
      {:ok, _} ->
        Postgres.exec(db, "DELETE FROM _refresh_tokens WHERE user_id = $1", [id])
        Postgres.exec(db, "DELETE FROM _users WHERE id = $1", [id])
        json(conn, %{data: %{id: id, deleted: true}})

      {:error, :not_found} ->
        respond_error(conn, AppError.not_found("User", id))

      {:error, err} ->
        respond_error(conn, wrap_error(err))
    end
  end

  # ── Permissions ──

  def list_permissions(conn, _params) do
    db = get_conn(conn)

    case Postgres.query_rows(db, "SELECT id, entity, action, roles, conditions, created_at, updated_at FROM _permissions ORDER BY entity, action") do
      {:ok, rows} -> json(conn, %{data: rows})
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def get_permission(conn, %{"id" => id}) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id, entity, action, roles, conditions, created_at, updated_at FROM _permissions WHERE id = $1", [id]) do
      {:ok, row} -> json(conn, %{data: row})
      {:error, :not_found} -> respond_error(conn, AppError.not_found("Permission", id))
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def create_permission(conn, params) do
    errs = []
    errs = if(!params["entity"] || params["entity"] == "", do: errs ++ [%{field: "entity", rule: "required", message: "entity is required"}], else: errs)
    errs = if(!params["action"] || params["action"] == "", do: errs ++ [%{field: "action", rule: "required", message: "action is required"}], else: errs)

    valid_actions = ["read", "create", "update", "delete"]
    errs = if(params["action"] && params["action"] not in valid_actions, do: errs ++ [%{field: "action", rule: "enum", message: "action must be one of: #{Enum.join(valid_actions, ", ")}"}], else: errs)

    if errs != [] do
      respond_error(conn, AppError.validation_failed(errs))
    else
      db = get_conn(conn)
      conditions = params["conditions"] || []

      case Postgres.query_row(db,
             "INSERT INTO _permissions (entity, action, roles, conditions) VALUES ($1, $2, $3, $4) RETURNING id, entity, action, roles, conditions, created_at, updated_at",
             [params["entity"], params["action"], params["roles"] || [], conditions]) do
        {:ok, row} ->
          reload_registry(conn)
          conn |> put_status(201) |> json(%{data: row})

        {:error, err} ->
          respond_error(conn, wrap_error(err))
      end
    end
  end

  def update_permission(conn, %{"id" => id} = params) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id FROM _permissions WHERE id = $1", [id]) do
      {:ok, _} ->
        {sets, prms, n} = build_update_sets(params, [{"entity", "entity"}, {"action", "action"}])

        {sets, prms, n} =
          if params["roles"] do
            n = n + 1
            {sets ++ ["roles = $#{n}"], prms ++ [params["roles"]], n}
          else
            {sets, prms, n}
          end

        {sets, prms, n} =
          if params["conditions"] do
            n = n + 1
            {sets ++ ["conditions = $#{n}"], prms ++ [params["conditions"]], n}
          else
            {sets, prms, n}
          end

        if sets == [] do
          fetch_and_return_permission(conn, db, id)
        else
          sets = sets ++ ["updated_at = NOW()"]
          n = n + 1
          prms = prms ++ [id]
          Postgres.exec(db, "UPDATE _permissions SET #{Enum.join(sets, ", ")} WHERE id = $#{n}", prms)
          reload_registry(conn)
          fetch_and_return_permission(conn, db, id)
        end

      {:error, :not_found} ->
        respond_error(conn, AppError.not_found("Permission", id))

      {:error, err} ->
        respond_error(conn, wrap_error(err))
    end
  end

  def delete_permission(conn, %{"id" => id}) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id FROM _permissions WHERE id = $1", [id]) do
      {:ok, _} ->
        Postgres.exec(db, "DELETE FROM _permissions WHERE id = $1", [id])
        reload_registry(conn)
        json(conn, %{data: %{id: id, deleted: true}})

      {:error, :not_found} ->
        respond_error(conn, AppError.not_found("Permission", id))

      {:error, err} ->
        respond_error(conn, wrap_error(err))
    end
  end

  # ── Webhooks ──

  def list_webhooks(conn, _params) do
    db = get_conn(conn)

    case Postgres.query_rows(db, "SELECT id, entity, hook, url, method, headers, condition, async, retry, active, created_at, updated_at FROM _webhooks ORDER BY entity, hook") do
      {:ok, rows} -> json(conn, %{data: rows})
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def get_webhook(conn, %{"id" => id}) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id, entity, hook, url, method, headers, condition, async, retry, active, created_at, updated_at FROM _webhooks WHERE id = $1", [id]) do
      {:ok, row} -> json(conn, %{data: row})
      {:error, :not_found} -> respond_error(conn, AppError.not_found("Webhook", id))
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def create_webhook(conn, params) do
    errs = []
    errs = if(!params["entity"] || params["entity"] == "", do: errs ++ [%{field: "entity", rule: "required", message: "entity is required"}], else: errs)
    errs = if(!params["url"] || params["url"] == "", do: errs ++ [%{field: "url", rule: "required", message: "url is required"}], else: errs)

    if errs != [] do
      respond_error(conn, AppError.validation_failed(errs))
    else
      db = get_conn(conn)
      hook = params["hook"] || "after_write"
      method = params["method"] || "POST"
      headers = params["headers"] || %{}
      condition = params["condition"] || ""
      async = if(params["async"] == nil, do: true, else: params["async"])
      retry = params["retry"] || %{"max_attempts" => 3, "backoff" => "exponential"}
      active = if(params["active"] == nil, do: true, else: params["active"])

      case Postgres.query_row(db,
             "INSERT INTO _webhooks (entity, hook, url, method, headers, condition, async, retry, active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, entity, hook, url, method, headers, condition, async, retry, active, created_at, updated_at",
             [params["entity"], hook, params["url"], method, headers, condition, async, retry, active]) do
        {:ok, row} ->
          reload_registry(conn)
          conn |> put_status(201) |> json(%{data: row})

        {:error, err} ->
          respond_error(conn, wrap_error(err))
      end
    end
  end

  def update_webhook(conn, %{"id" => id} = params) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id FROM _webhooks WHERE id = $1", [id]) do
      {:ok, _} ->
        {sets, prms, n} = build_update_sets(params, [
          {"entity", "entity"}, {"hook", "hook"}, {"url", "url"},
          {"method", "method"}, {"condition", "condition"}, {"async", "async"}, {"active", "active"}
        ])

        {sets, prms, n} = add_jsonb_set(sets, prms, n, params, "headers")
        {sets, prms, n} = add_jsonb_set(sets, prms, n, params, "retry")

        if sets == [] do
          fetch_and_return_webhook(conn, db, id)
        else
          sets = sets ++ ["updated_at = NOW()"]
          n = n + 1
          prms = prms ++ [id]
          Postgres.exec(db, "UPDATE _webhooks SET #{Enum.join(sets, ", ")} WHERE id = $#{n}", prms)
          reload_registry(conn)
          fetch_and_return_webhook(conn, db, id)
        end

      {:error, :not_found} ->
        respond_error(conn, AppError.not_found("Webhook", id))

      {:error, err} ->
        respond_error(conn, wrap_error(err))
    end
  end

  def delete_webhook(conn, %{"id" => id}) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id FROM _webhooks WHERE id = $1", [id]) do
      {:ok, _} ->
        Postgres.exec(db, "DELETE FROM _webhook_logs WHERE webhook_id = $1", [id])
        Postgres.exec(db, "DELETE FROM _webhooks WHERE id = $1", [id])
        reload_registry(conn)
        json(conn, %{data: %{id: id, deleted: true}})

      {:error, :not_found} ->
        respond_error(conn, AppError.not_found("Webhook", id))

      {:error, err} ->
        respond_error(conn, wrap_error(err))
    end
  end

  # ── Webhook Logs ──

  def list_webhook_logs(conn, params) do
    db = get_conn(conn)

    {where, prms, n} = {"", [], 0}

    {where, prms, n} =
      if params["webhook_id"] && params["webhook_id"] != "" do
        n = n + 1
        clause = if(where == "", do: "WHERE ", else: where <> " AND ")
        {clause <> "webhook_id = $#{n}", prms ++ [params["webhook_id"]], n}
      else
        {where, prms, n}
      end

    {where, prms, n} =
      if params["status"] && params["status"] != "" do
        n = n + 1
        clause = if(where == "", do: "WHERE ", else: where <> " AND ")
        {clause <> "status = $#{n}", prms ++ [params["status"]], n}
      else
        {where, prms, n}
      end

    {where, prms, _n} =
      if params["entity"] && params["entity"] != "" do
        n = n + 1
        clause = if(where == "", do: "WHERE ", else: where <> " AND ")
        {clause <> "entity = $#{n}", prms ++ [params["entity"]], n}
      else
        {where, prms, n}
      end

    sql = "SELECT id, webhook_id, entity, hook, url, method, request_headers, request_body, response_status, response_body, status, attempt, max_attempts, next_retry_at, error, idempotency_key, created_at, updated_at FROM _webhook_logs #{where} ORDER BY created_at DESC LIMIT 200"

    case Postgres.query_rows(db, sql, prms) do
      {:ok, rows} -> json(conn, %{data: rows})
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def get_webhook_log(conn, %{"id" => id}) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id, webhook_id, entity, hook, url, method, request_headers, request_body, response_status, response_body, status, attempt, max_attempts, next_retry_at, error, idempotency_key, created_at, updated_at FROM _webhook_logs WHERE id = $1", [id]) do
      {:ok, row} -> json(conn, %{data: row})
      {:error, :not_found} -> respond_error(conn, AppError.not_found("WebhookLog", id))
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def retry_webhook_log(conn, %{"id" => id}) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT id, status FROM _webhook_logs WHERE id = $1", [id]) do
      {:ok, %{"status" => status}} when status in ["failed", "retrying"] ->
        Postgres.exec(db,
          "UPDATE _webhook_logs SET status = 'retrying', next_retry_at = NOW(), updated_at = NOW() WHERE id = $1",
          [id])

        case Postgres.query_row(db, "SELECT id, webhook_id, entity, hook, url, method, request_headers, request_body, response_status, response_body, status, attempt, max_attempts, next_retry_at, error, idempotency_key, created_at, updated_at FROM _webhook_logs WHERE id = $1", [id]) do
          {:ok, row} -> json(conn, %{data: row})
          {:error, err} -> respond_error(conn, wrap_error(err))
        end

      {:ok, %{"status" => status}} ->
        respond_error(conn, AppError.validation_failed([
          %{field: "status", rule: "invalid", message: "Cannot retry log with status '#{status}', must be 'failed' or 'retrying'"}
        ]))

      {:error, :not_found} ->
        respond_error(conn, AppError.not_found("WebhookLog", id))

      {:error, err} ->
        respond_error(conn, wrap_error(err))
    end
  end

  # ── Export/Import ──

  def export(conn, _params) do
    db = get_conn(conn)

    with {:ok, entities} <- Postgres.query_rows(db, "SELECT name, table_name, definition, created_at, updated_at FROM _entities ORDER BY name"),
         {:ok, relations} <- Postgres.query_rows(db, "SELECT name, source, target, definition, created_at, updated_at FROM _relations ORDER BY name"),
         {:ok, rules} <- Postgres.query_rows(db, "SELECT id, entity, hook, type, definition, priority, active FROM _rules ORDER BY entity, priority"),
         {:ok, state_machines} <- Postgres.query_rows(db, "SELECT id, entity, field, definition, active FROM _state_machines ORDER BY entity"),
         {:ok, workflows} <- Postgres.query_rows(db, "SELECT id, name, trigger, context, steps, active FROM _workflows ORDER BY name"),
         {:ok, permissions} <- Postgres.query_rows(db, "SELECT id, entity, action, roles, conditions FROM _permissions ORDER BY entity, action"),
         {:ok, webhooks} <- Postgres.query_rows(db, "SELECT id, entity, hook, url, method, headers, condition, async, retry, active FROM _webhooks ORDER BY entity, hook") do
      json(conn, %{data: %{
        version: 1,
        exported_at: DateTime.utc_now() |> DateTime.to_iso8601(),
        entities: entities,
        relations: relations,
        rules: rules,
        state_machines: state_machines,
        workflows: workflows,
        permissions: permissions,
        webhooks: webhooks
      }})
    else
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  def import_schema(conn, params) do
    db = get_conn(conn)
    registry = get_registry(conn)
    summary = %{entities: 0, relations: 0, rules: 0, state_machines: 0, workflows: 0, permissions: 0, webhooks: 0, records: 0}
    errors = []

    # Step 1: Entities
    {summary, errors} =
      Enum.reduce(params["entities"] || [], {summary, errors}, fn ent, {sum, errs} ->
        name = ent["name"]
        table = ent["table_name"] || ent["table"]

        # Support both DB export format (has "definition" key) and flat format
        # (the entire object IS the definition, like Go/Express imports)
        definition = ent["definition"] || ent

        if name && table do
          def_val = ensure_decoded(definition, %{})

          case Postgres.exec(db, "INSERT INTO _entities (name, table_name, definition) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET table_name = EXCLUDED.table_name, definition = EXCLUDED.definition, updated_at = NOW()", [name, table, def_val]) do
            {:ok, _} ->
              entity = parse_entity_from_definition(name, table, def_val)
              if entity, do: Migrator.migrate(db, entity)
              {Map.update!(sum, :entities, &(&1 + 1)), errs}

            {:error, err} ->
              {sum, errs ++ ["Entity #{name}: #{inspect(err)}"]}
          end
        else
          {sum, errs ++ ["Entity missing name or table"]}
        end
      end)

    reload_registry(conn)

    # Step 2: Relations
    {summary, errors} =
      Enum.reduce(params["relations"] || [], {summary, errors}, fn rel, {sum, errs} ->
        name = rel["name"]
        source = rel["source"]
        target = rel["target"]

        # Support both DB export format (has "definition" key) and flat format
        definition = rel["definition"] || rel

        if name && source && target do
          def_val = ensure_decoded(definition, %{})

          case Postgres.exec(db, "INSERT INTO _relations (name, source, target, definition) VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO UPDATE SET source = EXCLUDED.source, target = EXCLUDED.target, definition = EXCLUDED.definition, updated_at = NOW()", [name, source, target, def_val]) do
            {:ok, _} ->
              parsed_rel = parse_relation_from_definition(name, source, target, def_val)

              if parsed_rel && Relation.many_to_many?(parsed_rel) do
                source_entity = Registry.get_entity(registry, source)
                target_entity = Registry.get_entity(registry, target)
                if source_entity && target_entity, do: Migrator.migrate_join_table(db, parsed_rel, source_entity, target_entity)
              end

              {Map.update!(sum, :relations, &(&1 + 1)), errs}

            {:error, err} ->
              {sum, errs ++ ["Relation #{name}: #{inspect(err)}"]}
          end
        else
          {sum, errs ++ ["Relation missing name, source, or target"]}
        end
      end)

    reload_registry(conn)

    # Step 3: Rules
    {summary, errors} =
      Enum.reduce(params["rules"] || [], {summary, errors}, fn rule, {sum, errs} ->
        entity = rule["entity"]
        hook = rule["hook"] || "before_write"
        type = rule["type"]
        definition = ensure_decoded(rule["definition"], %{})

        case Postgres.exec(db, "INSERT INTO _rules (entity, hook, type, definition, priority, active) VALUES ($1, $2, $3, $4, $5, $6)", [entity, hook, type, definition, rule["priority"] || 0, if(rule["active"] == nil, do: true, else: rule["active"])]) do
          {:ok, _} -> {Map.update!(sum, :rules, &(&1 + 1)), errs}
          {:error, err} -> {sum, errs ++ ["Rule for #{entity}: #{inspect(err)}"]}
        end
      end)

    # Step 4: State Machines
    {summary, errors} =
      Enum.reduce(params["state_machines"] || [], {summary, errors}, fn sm, {sum, errs} ->
        definition = ensure_decoded(sm["definition"], %{})

        case Postgres.exec(db, "INSERT INTO _state_machines (entity, field, definition, active) VALUES ($1, $2, $3, $4)", [sm["entity"], sm["field"], definition, if(sm["active"] == nil, do: true, else: sm["active"])]) do
          {:ok, _} -> {Map.update!(sum, :state_machines, &(&1 + 1)), errs}
          {:error, err} -> {sum, errs ++ ["StateMachine for #{sm["entity"]}: #{inspect(err)}"]}
        end
      end)

    # Step 5: Workflows
    {summary, errors} =
      Enum.reduce(params["workflows"] || [], {summary, errors}, fn wf, {sum, errs} ->
        trigger = ensure_decoded(wf["trigger"], %{})
        context = ensure_decoded(wf["context"], %{})
        steps = ensure_decoded(wf["steps"], [])

        case Postgres.exec(db, "INSERT INTO _workflows (name, trigger, context, steps, active) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (name) DO NOTHING", [wf["name"], trigger, context, steps, if(wf["active"] == nil, do: true, else: wf["active"])]) do
          {:ok, n} when n > 0 -> {Map.update!(sum, :workflows, &(&1 + 1)), errs}
          {:ok, _} -> {sum, errs}
          {:error, err} -> {sum, errs ++ ["Workflow #{wf["name"]}: #{inspect(err)}"]}
        end
      end)

    # Step 6: Permissions
    {summary, errors} =
      Enum.reduce(params["permissions"] || [], {summary, errors}, fn perm, {sum, errs} ->
        conditions = ensure_decoded(perm["conditions"], [])

        case Postgres.exec(db, "INSERT INTO _permissions (entity, action, roles, conditions) VALUES ($1, $2, $3, $4)", [perm["entity"], perm["action"], perm["roles"] || [], conditions]) do
          {:ok, _} -> {Map.update!(sum, :permissions, &(&1 + 1)), errs}
          {:error, err} -> {sum, errs ++ ["Permission for #{perm["entity"]}: #{inspect(err)}"]}
        end
      end)

    # Step 7: Webhooks
    {summary, errors} =
      Enum.reduce(params["webhooks"] || [], {summary, errors}, fn wh, {sum, errs} ->
        headers = ensure_decoded(wh["headers"], %{})
        retry = ensure_decoded(wh["retry"], %{"max_attempts" => 3, "backoff" => "exponential"})

        case Postgres.exec(db, "INSERT INTO _webhooks (entity, hook, url, method, headers, condition, async, retry, active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)", [wh["entity"], wh["hook"] || "after_write", wh["url"], wh["method"] || "POST", headers, wh["condition"] || "", if(wh["async"] == nil, do: true, else: wh["async"]), retry, if(wh["active"] == nil, do: true, else: wh["active"])]) do
          {:ok, _} -> {Map.update!(sum, :webhooks, &(&1 + 1)), errs}
          {:error, err} -> {sum, errs ++ ["Webhook for #{wh["entity"]}: #{inspect(err)}"]}
        end
      end)

    # Step 8: Sample data
    reload_registry(conn)

    {summary, errors} =
      Enum.reduce(params["sample_data"] || %{}, {summary, errors}, fn
        {entity_name, records}, {sum, errs} when is_list(records) ->
          entity = Registry.get_entity(registry, entity_name)

          if entity do
            Enum.reduce(records, {sum, errs}, fn
              record, {s, e} when is_map(record) ->
                {cols, vals, prms, _n} =
                  Enum.reduce(record, {[], [], [], 0}, fn {k, v}, {cols, vals, prms, n} ->
                    field = Entity.get_field(entity, k)

                    if field do
                      n = n + 1
                      coerced = coerce_value(v, field.type)
                      {cols ++ [k], vals ++ ["$#{n}"], prms ++ [coerced], n}
                    else
                      {cols, vals, prms, n}
                    end
                  end)

                if cols != [] do
                  sql = "INSERT INTO #{entity.table} (#{Enum.join(cols, ", ")}) VALUES (#{Enum.join(vals, ", ")}) ON CONFLICT DO NOTHING"

                  try do
                    case Postgres.exec(db, sql, prms) do
                      {:ok, n} when n > 0 -> {Map.update!(s, :records, &(&1 + 1)), e}
                      {:ok, _} -> {s, e}
                      {:error, err} -> {s, e ++ ["Record for #{entity_name}: #{inspect(err)}"]}
                    end
                  rescue
                    err -> {s, e ++ ["Record for #{entity_name}: #{Exception.message(err)}"]}
                  end
                else
                  {s, e}
                end

              _record, acc ->
                acc
            end)
          else
            # Not a registered entity — may be a join table (many_to_many)
            # Insert rows directly with all values as strings
            Enum.reduce(records, {sum, errs}, fn
              record, {s, e} when is_map(record) ->
                {cols, vals, prms, _n} =
                  Enum.reduce(record, {[], [], [], 0}, fn {k, v}, {cols, vals, prms, n} ->
                    n = n + 1
                    {cols ++ [k], vals ++ ["$#{n}"], prms ++ [v], n}
                  end)

                if cols != [] do
                  sql = "INSERT INTO #{entity_name} (#{Enum.join(cols, ", ")}) VALUES (#{Enum.join(vals, ", ")}) ON CONFLICT DO NOTHING"

                  try do
                    case Postgres.exec(db, sql, prms) do
                      {:ok, n} when n > 0 -> {Map.update!(s, :records, &(&1 + 1)), e}
                      {:ok, _} -> {s, e}
                      {:error, err} -> {s, e ++ ["Record for #{entity_name}: #{inspect(err)}"]}
                    end
                  rescue
                    err -> {s, e ++ ["Record for #{entity_name}: #{Exception.message(err)}"]}
                  end
                else
                  {s, e}
                end

              _record, acc ->
                acc
            end)
          end

        _entry, acc ->
          acc
      end)

    reload_registry(conn)

    result = %{message: "Import completed", summary: summary}
    result = if errors != [], do: Map.put(result, :errors, errors), else: result

    json(conn, %{data: result})
  end

  # ── Private helpers ──

  defp get_conn(conn) do
    conn.assigns[:db_conn] || Rocket.Repo
  end

  defp get_registry(conn) do
    conn.assigns[:registry] || Rocket.Metadata.Registry
  end

  defp reload_registry(conn) do
    db = get_conn(conn)
    registry = get_registry(conn)
    Loader.load_all(db, registry)
  end

  defp respond_error(conn, %AppError{} = err) do
    conn
    |> put_status(err.status)
    |> json(%{error: AppError.to_json(err)})
  end

  defp wrap_error(%AppError{} = err), do: err
  defp wrap_error(err), do: AppError.new("INTERNAL_ERROR", 500, "#{inspect(err)}")

  defp parse_entity(params) do
    name = params["name"]
    table = params["table"] || params["table_name"] || name

    if !name || name == "" do
      {:error, AppError.validation_failed([%{field: "name", rule: "required", message: "name is required"}])}
    else
      pk_raw = params["primary_key"] || %{"field" => "id", "type" => "uuid"}

      pk = %Rocket.Metadata.PrimaryKey{
        field: pk_raw["field"] || "id",
        type: pk_raw["type"] || "uuid",
        generated: Map.get(pk_raw, "generated", true)
      }

      fields =
        (params["fields"] || [])
        |> Enum.map(&Rocket.Metadata.Field.from_map/1)

      soft_delete = Map.get(params, "soft_delete", false)

      entity = %Entity{
        name: name,
        table: table,
        primary_key: pk,
        fields: fields,
        soft_delete: soft_delete
      }

      {:ok, entity}
    end
  end

  defp validate_entity(%Entity{} = entity) do
    errs = []
    errs = if(entity.name == "" || entity.name == nil, do: errs ++ [%{field: "name", rule: "required", message: "name is required"}], else: errs)
    errs = if(entity.fields == [], do: errs ++ [%{field: "fields", rule: "required", message: "at least one field is required"}], else: errs)

    if errs != [] do
      {:error, AppError.validation_failed(errs)}
    else
      :ok
    end
  end

  defp check_entity_not_exists(conn, name) do
    registry = get_registry(conn)

    if Registry.get_entity(registry, name) do
      {:error, AppError.conflict("Entity '#{name}' already exists")}
    else
      :ok
    end
  end

  defp check_entity_exists(conn, name) do
    db = get_conn(conn)

    case Postgres.query_row(db, "SELECT name FROM _entities WHERE name = $1", [name]) do
      {:ok, _} -> :ok
      {:error, :not_found} -> {:error, AppError.not_found("Entity", name)}
      {:error, err} -> {:error, wrap_error(err)}
    end
  end

  defp entity_to_definition(%Entity{} = entity) do
    fields =
      Enum.map(entity.fields, fn f ->
        m = %{"name" => f.name, "type" => f.type}
        m = if f.required, do: Map.put(m, "required", true), else: m
        m = if f.unique, do: Map.put(m, "unique", true), else: m
        m = if f.nullable, do: Map.put(m, "nullable", true), else: m
        m = if f.default != nil, do: Map.put(m, "default", f.default), else: m
        m = if f.enum != nil && f.enum != [], do: Map.put(m, "enum", f.enum), else: m
        m = if f.auto != nil && f.auto != "", do: Map.put(m, "auto", f.auto), else: m
        m
      end)

    %{
      "primary_key" => %{
        "field" => entity.primary_key.field,
        "type" => entity.primary_key.type,
        "generated" => entity.primary_key.generated
      },
      "fields" => fields,
      "soft_delete" => entity.soft_delete
    }
  end

  defp parse_relation(params) do
    name = params["name"]
    source = params["source"]
    target = params["target"]

    errs = []
    errs = if(!name || name == "", do: errs ++ [%{field: "name", rule: "required", message: "name is required"}], else: errs)
    errs = if(!source || source == "", do: errs ++ [%{field: "source", rule: "required", message: "source is required"}], else: errs)
    errs = if(!target || target == "", do: errs ++ [%{field: "target", rule: "required", message: "target is required"}], else: errs)

    if errs != [] do
      {:error, AppError.validation_failed(errs)}
    else
      type = params["type"] || "one_to_many"
      source_key = params["source_key"] || "id"
      target_key = params["target_key"] || "#{source}_id"

      rel = %Relation{
        name: name,
        source: source,
        target: target,
        type: type,
        source_key: source_key,
        target_key: target_key,
        join_table: params["join_table"],
        source_join_key: params["source_join_key"],
        target_join_key: params["target_join_key"],
        on_delete: params["on_delete"] || "no_action"
      }

      {:ok, rel}
    end
  end

  defp validate_relation(conn, %Relation{} = rel) do
    registry = get_registry(conn)

    valid_types = ["one_to_one", "one_to_many", "many_to_many"]

    cond do
      rel.type not in valid_types ->
        {:error, AppError.validation_failed([%{field: "type", rule: "enum", message: "type must be one of: #{Enum.join(valid_types, ", ")}"}])}

      Registry.get_entity(registry, rel.source) == nil ->
        {:error, AppError.validation_failed([%{field: "source", rule: "exists", message: "source entity '#{rel.source}' does not exist"}])}

      Registry.get_entity(registry, rel.target) == nil ->
        {:error, AppError.validation_failed([%{field: "target", rule: "exists", message: "target entity '#{rel.target}' does not exist"}])}

      rel.type == "many_to_many" && (!rel.join_table || rel.join_table == "") ->
        {:error, AppError.validation_failed([%{field: "join_table", rule: "required", message: "join_table is required for many_to_many relations"}])}

      true ->
        :ok
    end
  end

  defp relation_to_definition(%Relation{} = rel) do
    m = %{
      "type" => rel.type,
      "source_key" => rel.source_key,
      "target_key" => rel.target_key,
      "on_delete" => rel.on_delete
    }

    m = if rel.join_table, do: Map.put(m, "join_table", rel.join_table), else: m
    m = if rel.source_join_key, do: Map.put(m, "source_join_key", rel.source_join_key), else: m
    m = if rel.target_join_key, do: Map.put(m, "target_join_key", rel.target_join_key), else: m
    m
  end

  defp validate_rule(conn, params) do
    errs = []
    errs = if(!params["entity"] || params["entity"] == "", do: errs ++ [%{field: "entity", rule: "required", message: "entity is required"}], else: errs)
    errs = if(!params["type"] || params["type"] == "", do: errs ++ [%{field: "type", rule: "required", message: "type is required"}], else: errs)

    valid_hooks = ["before_write", "before_delete"]
    errs = if(params["hook"] && params["hook"] not in valid_hooks, do: errs ++ [%{field: "hook", rule: "enum", message: "hook must be one of: #{Enum.join(valid_hooks, ", ")}"}], else: errs)

    valid_types = ["field", "expression", "computed"]
    errs = if(params["type"] && params["type"] not in valid_types, do: errs ++ [%{field: "type", rule: "enum", message: "type must be one of: #{Enum.join(valid_types, ", ")}"}], else: errs)

    registry = get_registry(conn)
    errs = if(params["entity"] && Registry.get_entity(registry, params["entity"]) == nil, do: errs ++ [%{field: "entity", rule: "exists", message: "entity '#{params["entity"]}' does not exist"}], else: errs)

    if errs != [] do
      {:error, AppError.validation_failed(errs)}
    else
      :ok
    end
  end

  defp validate_state_machine(conn, params) do
    errs = []
    errs = if(!params["entity"] || params["entity"] == "", do: errs ++ [%{field: "entity", rule: "required", message: "entity is required"}], else: errs)
    errs = if(!params["field"] || params["field"] == "", do: errs ++ [%{field: "field", rule: "required", message: "field is required"}], else: errs)
    errs = if(!params["definition"], do: errs ++ [%{field: "definition", rule: "required", message: "definition is required"}], else: errs)

    registry = get_registry(conn)
    errs = if(params["entity"] && Registry.get_entity(registry, params["entity"]) == nil, do: errs ++ [%{field: "entity", rule: "exists", message: "entity '#{params["entity"]}' does not exist"}], else: errs)

    if errs != [] do
      {:error, AppError.validation_failed(errs)}
    else
      :ok
    end
  end

  defp validate_workflow(params) do
    errs = []
    errs = if(!params["name"] || params["name"] == "", do: errs ++ [%{field: "name", rule: "required", message: "name is required"}], else: errs)
    errs = if(!params["trigger"], do: errs ++ [%{field: "trigger", rule: "required", message: "trigger is required"}], else: errs)
    errs = if(!params["steps"] || params["steps"] == [], do: errs ++ [%{field: "steps", rule: "required", message: "at least one step is required"}], else: errs)

    if errs != [] do
      {:error, AppError.validation_failed(errs)}
    else
      :ok
    end
  end

  defp build_update_sets(params, fields) do
    Enum.reduce(fields, {[], [], 0}, fn {param_key, _col}, {sets, prms, n} ->
      if Map.has_key?(params, param_key) && param_key not in ["id", "name" | reserved_keys()] do
        n = n + 1
        {sets ++ ["#{param_key} = $#{n}"], prms ++ [params[param_key]], n}
      else
        {sets, prms, n}
      end
    end)
  end

  defp reserved_keys, do: ["entity", "id"]

  defp add_jsonb_set(sets, prms, n, params, key) do
    if params[key] do
      n = n + 1
      {sets ++ ["#{key} = $#{n}"], prms ++ [params[key]], n}
    else
      {sets, prms, n}
    end
  end

  # Ensure a value is a decoded Elixir map/list (not a JSON string).
  # Postgrex handles JSONB encoding internally — passing a pre-encoded
  # JSON string causes double-encoding.
  defp ensure_decoded(val, _default) when is_map(val) or is_list(val), do: val
  defp ensure_decoded(val, _default) when is_binary(val) do
    case Jason.decode(val) do
      {:ok, decoded} -> decoded
      _ -> val
    end
  end
  defp ensure_decoded(nil, default), do: default
  defp ensure_decoded(_, default), do: default

  defp fetch_and_return_state_machine(conn, db, id) do
    case Postgres.query_row(db, "SELECT id, entity, field, definition, active, created_at, updated_at FROM _state_machines WHERE id = $1", [id]) do
      {:ok, row} -> json(conn, %{data: row})
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  defp fetch_and_return_workflow(conn, db, id) do
    case Postgres.query_row(db, "SELECT id, name, trigger, context, steps, active, created_at, updated_at FROM _workflows WHERE id = $1", [id]) do
      {:ok, row} -> json(conn, %{data: row})
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  defp fetch_and_return_user(conn, db, id) do
    case Postgres.query_row(db, "SELECT id, email, roles, active, created_at, updated_at FROM _users WHERE id = $1", [id]) do
      {:ok, row} -> json(conn, %{data: row})
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  defp fetch_and_return_permission(conn, db, id) do
    case Postgres.query_row(db, "SELECT id, entity, action, roles, conditions, created_at, updated_at FROM _permissions WHERE id = $1", [id]) do
      {:ok, row} -> json(conn, %{data: row})
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  defp fetch_and_return_webhook(conn, db, id) do
    case Postgres.query_row(db, "SELECT id, entity, hook, url, method, headers, condition, async, retry, active, created_at, updated_at FROM _webhooks WHERE id = $1", [id]) do
      {:ok, row} -> json(conn, %{data: row})
      {:error, err} -> respond_error(conn, wrap_error(err))
    end
  end

  # Coerce JSON values to the types Postgrex expects for each column type.
  defp coerce_value(nil, _type), do: nil

  defp coerce_value(v, t) when t in ["int", "integer", "bigint"] and is_binary(v) do
    case Integer.parse(v) do
      {n, _} -> n
      :error -> v
    end
  end

  defp coerce_value(v, t) when t in ["int", "integer", "bigint"] and is_float(v),
    do: trunc(v)

  defp coerce_value(v, t) when t in ["int", "integer", "bigint"] and is_integer(v), do: v

  defp coerce_value(v, "float") when is_binary(v) do
    case Float.parse(v) do
      {f, _} -> f
      :error -> v
    end
  end

  defp coerce_value(v, "float") when is_integer(v), do: v * 1.0
  defp coerce_value(v, "float") when is_float(v), do: v

  defp coerce_value(v, "decimal") when is_binary(v) do
    case Decimal.parse(v) do
      {d, _} -> d
      :error -> v
    end
  end

  defp coerce_value(v, "decimal") when is_integer(v), do: Decimal.new(v)
  defp coerce_value(v, "decimal") when is_float(v), do: Decimal.from_float(v)

  defp coerce_value(v, "boolean") when is_binary(v), do: v in ["true", "1", "yes"]
  defp coerce_value(v, "boolean") when is_boolean(v), do: v
  defp coerce_value(v, "boolean") when is_integer(v), do: v != 0

  defp coerce_value(v, t) when t in ["string", "text"] and is_integer(v),
    do: Integer.to_string(v)

  defp coerce_value(v, t) when t in ["string", "text"] and is_float(v),
    do: Float.to_string(v)

  defp coerce_value(v, t) when t in ["string", "text"] and is_binary(v), do: v

  defp coerce_value(v, "timestamp") when is_binary(v) do
    case DateTime.from_iso8601(v) do
      {:ok, dt, _offset} -> dt
      _ ->
        case NaiveDateTime.from_iso8601(v) do
          {:ok, ndt} -> ndt
          _ -> v
        end
    end
  end

  defp coerce_value(v, "date") when is_binary(v) do
    case Date.from_iso8601(v) do
      {:ok, d} -> d
      _ -> v
    end
  end

  defp coerce_value(v, t) when t in ["json", "file"] and (is_map(v) or is_list(v)), do: v

  defp coerce_value(v, t) when t in ["json", "file"] and is_binary(v) do
    case Jason.decode(v) do
      {:ok, decoded} -> decoded
      _ -> v
    end
  end

  defp coerce_value(v, _type), do: v

  defp parse_entity_from_definition(name, table, definition) do
    def_map = if is_binary(definition), do: Jason.decode!(definition), else: definition
    merged = Map.merge(def_map, %{"name" => name, "table" => table || name})

    try do
      Entity.from_map(merged)
    rescue
      _ -> nil
    end
  end

  defp parse_relation_from_definition(name, source, target, definition) do
    def_map = if is_binary(definition), do: Jason.decode!(definition), else: definition
    merged = Map.merge(def_map, %{"name" => name, "source" => source, "target" => target})

    try do
      Relation.from_map(merged)
    rescue
      _ -> nil
    end
  end
end
