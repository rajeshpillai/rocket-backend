defmodule Rocket.Metadata.Registry do
  @moduledoc "GenServer-based in-memory metadata cache."
  use GenServer

  # ── Client API ──

  def start_link(opts \\ []) do
    name = Keyword.get(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, %{}, name: name)
  end

  def get_entity(reg \\ __MODULE__, name), do: GenServer.call(reg, {:get_entity, name})
  def all_entities(reg \\ __MODULE__), do: GenServer.call(reg, :all_entities)

  def get_relation(reg \\ __MODULE__, name), do: GenServer.call(reg, {:get_relation, name})
  def all_relations(reg \\ __MODULE__), do: GenServer.call(reg, :all_relations)

  def get_relations_for_source(reg \\ __MODULE__, entity_name),
    do: GenServer.call(reg, {:get_relations_for_source, entity_name})

  def find_relation_for_entity(reg \\ __MODULE__, relation_name, entity_name),
    do: GenServer.call(reg, {:find_relation_for_entity, relation_name, entity_name})

  def get_rules_for_entity(reg \\ __MODULE__, entity_name, hook),
    do: GenServer.call(reg, {:get_rules_for_entity, entity_name, hook})

  def get_state_machines_for_entity(reg \\ __MODULE__, entity_name),
    do: GenServer.call(reg, {:get_state_machines_for_entity, entity_name})

  def get_workflows_for_trigger(reg \\ __MODULE__, entity, field, to_state),
    do: GenServer.call(reg, {:get_workflows_for_trigger, entity, field, to_state})

  def get_workflow(reg \\ __MODULE__, name),
    do: GenServer.call(reg, {:get_workflow, name})

  def get_permissions(reg \\ __MODULE__, entity, action),
    do: GenServer.call(reg, {:get_permissions, entity, action})

  def get_webhooks_for_entity_hook(reg \\ __MODULE__, entity, hook),
    do: GenServer.call(reg, {:get_webhooks_for_entity_hook, entity, hook})

  # Load functions
  def load(reg \\ __MODULE__, entities, relations),
    do: GenServer.call(reg, {:load, entities, relations})

  def load_rules(reg \\ __MODULE__, rules),
    do: GenServer.call(reg, {:load_rules, rules})

  def load_state_machines(reg \\ __MODULE__, machines),
    do: GenServer.call(reg, {:load_state_machines, machines})

  def load_workflows(reg \\ __MODULE__, workflows),
    do: GenServer.call(reg, {:load_workflows, workflows})

  def load_permissions(reg \\ __MODULE__, permissions),
    do: GenServer.call(reg, {:load_permissions, permissions})

  def load_webhooks(reg \\ __MODULE__, webhooks),
    do: GenServer.call(reg, {:load_webhooks, webhooks})

  # ── Server ──

  @impl true
  def init(_) do
    {:ok, empty_state()}
  end

  defp empty_state do
    %{
      entities: %{},
      relations_by_name: %{},
      relations_by_source: %{},
      rules_by_entity: %{},
      state_machines_by_entity: %{},
      workflows_by_trigger: %{},
      workflows_by_name: %{},
      permissions_by_entity_action: %{},
      webhooks_by_entity_hook: %{}
    }
  end

  @impl true
  def handle_call({:get_entity, name}, _from, state) do
    {:reply, Map.get(state.entities, name), state}
  end

  def handle_call(:all_entities, _from, state) do
    {:reply, Map.values(state.entities), state}
  end

  def handle_call({:get_relation, name}, _from, state) do
    {:reply, Map.get(state.relations_by_name, name), state}
  end

  def handle_call(:all_relations, _from, state) do
    {:reply, Map.values(state.relations_by_name), state}
  end

  def handle_call({:get_relations_for_source, entity_name}, _from, state) do
    {:reply, Map.get(state.relations_by_source, entity_name, []), state}
  end

  def handle_call({:find_relation_for_entity, relation_name, entity_name}, _from, state) do
    rel = Map.get(state.relations_by_name, relation_name)

    result =
      cond do
        rel != nil && (rel.source == entity_name || rel.target == entity_name) ->
          rel

        true ->
          # Search by target/source entity name as include alias
          found =
            state.relations_by_name
            |> Map.values()
            |> Enum.find(fn r ->
              (r.source == entity_name && r.target == relation_name) ||
                (r.target == entity_name && r.source == relation_name)
            end)

          # Fallback: check for relation named "{entity}_{include}" (e.g. post_tags)
          found || Map.get(state.relations_by_name, "#{entity_name}_#{relation_name}")
      end

    {:reply, result, state}
  end

  def handle_call({:get_rules_for_entity, entity_name, hook}, _from, state) do
    rules =
      state.rules_by_entity
      |> Map.get(entity_name, [])
      |> Enum.filter(&(&1.active && &1.hook == hook))

    {:reply, rules, state}
  end

  def handle_call({:get_state_machines_for_entity, entity_name}, _from, state) do
    machines =
      state.state_machines_by_entity
      |> Map.get(entity_name, [])
      |> Enum.filter(& &1.active)

    {:reply, machines, state}
  end

  def handle_call({:get_workflows_for_trigger, entity, field, to_state}, _from, state) do
    key = "#{entity}:#{field}:#{to_state}"

    workflows =
      state.workflows_by_trigger
      |> Map.get(key, [])
      |> Enum.filter(& &1.active)

    {:reply, workflows, state}
  end

  def handle_call({:get_workflow, name}, _from, state) do
    {:reply, Map.get(state.workflows_by_name, name), state}
  end

  def handle_call({:get_permissions, entity, action}, _from, state) do
    key = "#{entity}:#{action}"
    {:reply, Map.get(state.permissions_by_entity_action, key, []), state}
  end

  def handle_call({:get_webhooks_for_entity_hook, entity, hook}, _from, state) do
    key = "#{entity}:#{hook}"

    webhooks =
      state.webhooks_by_entity_hook
      |> Map.get(key, [])
      |> Enum.filter(& &1.active)

    {:reply, webhooks, state}
  end

  # ── Load handlers ──

  def handle_call({:load, entities, relations}, _from, state) do
    entities_map = Map.new(entities, &{&1.name, &1})

    relations_by_name = Map.new(relations, &{&1.name, &1})

    relations_by_source =
      Enum.group_by(relations, & &1.source)

    state = %{
      state
      | entities: entities_map,
        relations_by_name: relations_by_name,
        relations_by_source: relations_by_source
    }

    {:reply, :ok, state}
  end

  def handle_call({:load_rules, rules}, _from, state) do
    by_entity =
      rules
      |> Enum.group_by(& &1.entity)
      |> Map.new(fn {k, v} -> {k, Enum.sort_by(v, & &1.priority)} end)

    {:reply, :ok, %{state | rules_by_entity: by_entity}}
  end

  def handle_call({:load_state_machines, machines}, _from, state) do
    by_entity = Enum.group_by(machines, & &1.entity)
    {:reply, :ok, %{state | state_machines_by_entity: by_entity}}
  end

  def handle_call({:load_workflows, workflows}, _from, state) do
    by_name = Map.new(workflows, &{&1.name, &1})

    by_trigger =
      workflows
      |> Enum.filter(&(&1.trigger.type == "state_change"))
      |> Enum.group_by(fn wf ->
        "#{wf.trigger.entity}:#{wf.trigger.field}:#{wf.trigger.to}"
      end)

    {:reply, :ok, %{state | workflows_by_name: by_name, workflows_by_trigger: by_trigger}}
  end

  def handle_call({:load_permissions, permissions}, _from, state) do
    by_ea =
      Enum.group_by(permissions, fn p -> "#{p.entity}:#{p.action}" end)

    {:reply, :ok, %{state | permissions_by_entity_action: by_ea}}
  end

  def handle_call({:load_webhooks, webhooks}, _from, state) do
    by_eh =
      Enum.group_by(webhooks, fn wh -> "#{wh.entity}:#{wh.hook}" end)

    {:reply, :ok, %{state | webhooks_by_entity_hook: by_eh}}
  end
end
