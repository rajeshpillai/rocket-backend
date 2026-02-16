defmodule Rocket.Metadata.PrimaryKey do
  defstruct field: "id", type: "uuid", generated: true
end

defmodule Rocket.Metadata.Field do
  defstruct [
    :name,
    :type,
    :default,
    :enum,
    :precision,
    :auto,
    required: false,
    unique: false,
    nullable: false
  ]

  def auto?(%__MODULE__{auto: auto}) when auto in ["create", "update"], do: true
  def auto?(_), do: false

  def from_map(map) when is_map(map) do
    %__MODULE__{
      name: map["name"],
      type: map["type"] || "string",
      required: map["required"] || false,
      unique: map["unique"] || false,
      default: map["default"],
      nullable: map["nullable"] || false,
      enum: map["enum"],
      precision: map["precision"],
      auto: map["auto"]
    }
  end
end

defmodule Rocket.Metadata.SlugConfig do
  defstruct [:field, :source, regenerate_on_update: false]

  def from_map(nil), do: nil

  def from_map(map) when is_map(map) do
    %__MODULE__{
      field: map["field"],
      source: map["source"],
      regenerate_on_update: map["regenerate_on_update"] || false
    }
  end
end

defmodule Rocket.Metadata.Entity do
  @moduledoc "Entity metadata struct."

  defstruct [
    :name,
    :table,
    :primary_key,
    :soft_delete,
    :slug,
    fields: []
  ]

  def get_field(%__MODULE__{fields: fields}, name) do
    Enum.find(fields, &(&1.name == name))
  end

  def has_field?(entity, name), do: get_field(entity, name) != nil

  def field_names(%__MODULE__{fields: fields}), do: Enum.map(fields, & &1.name)

  def writable_fields(%__MODULE__{} = entity) do
    Enum.reject(entity.fields, fn f ->
      (f.name == entity.primary_key.field && entity.primary_key.generated) ||
        field_auto?(f)
    end)
  end

  def updatable_fields(%__MODULE__{} = entity) do
    Enum.reject(entity.fields, fn f ->
      f.name == entity.primary_key.field || field_auto?(f) || f.name == "deleted_at"
    end)
  end

  defp field_auto?(%{auto: auto}) when auto in ["create", "update"], do: true
  defp field_auto?(_), do: false

  def from_map(map) when is_map(map) do
    pk_map = map["primary_key"] || %{}

    %__MODULE__{
      name: map["name"],
      table: map["table"] || map["name"],
      soft_delete: map["soft_delete"] || false,
      slug: Rocket.Metadata.SlugConfig.from_map(map["slug"]),
      primary_key: %Rocket.Metadata.PrimaryKey{
        field: pk_map["field"] || "id",
        type: pk_map["type"] || "uuid",
        generated: Map.get(pk_map, "generated", true)
      },
      fields:
        (map["fields"] || [])
        |> Enum.map(&Rocket.Metadata.Field.from_map/1)
    }
  end
end

defmodule Rocket.Metadata.Relation do
  defstruct [
    :name,
    :type,
    :source,
    :target,
    :source_key,
    :target_key,
    :join_table,
    :source_join_key,
    :target_join_key,
    :ownership,
    :on_delete,
    fetch: "lazy",
    write_mode: "diff"
  ]

  def many_to_many?(%__MODULE__{type: "many_to_many"}), do: true
  def many_to_many?(_), do: false

  def one_to_many?(%__MODULE__{type: "one_to_many"}), do: true
  def one_to_many?(_), do: false

  def one_to_one?(%__MODULE__{type: "one_to_one"}), do: true
  def one_to_one?(_), do: false

  def default_write_mode(%__MODULE__{write_mode: nil}), do: "diff"
  def default_write_mode(%__MODULE__{write_mode: ""}), do: "diff"
  def default_write_mode(%__MODULE__{write_mode: mode}), do: mode

  def from_map(map) when is_map(map) do
    %__MODULE__{
      name: map["name"],
      type: map["type"],
      source: map["source"],
      target: map["target"],
      source_key: map["source_key"],
      target_key: map["target_key"],
      join_table: map["join_table"],
      source_join_key: map["source_join_key"],
      target_join_key: map["target_join_key"],
      ownership: map["ownership"] || "none",
      on_delete: map["on_delete"] || "detach",
      fetch: map["fetch"] || "lazy",
      write_mode: map["write_mode"] || "diff"
    }
  end
end
