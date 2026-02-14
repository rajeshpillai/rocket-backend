defmodule Rocket.Config do
  @moduledoc "Loads configuration from app.yaml"

  defstruct [
    :server_port,
    :jwt_secret,
    :platform_jwt_secret,
    :app_pool_size,
    :storage,
    :database,
    :instrumentation
  ]

  defmodule Database do
    defstruct [:host, :port, :user, :password, :name, :pool_size, driver: "postgres", data_dir: "./data"]

    def conn_string(%__MODULE__{} = db) do
      "postgres://#{db.user}:#{db.password}@#{db.host}:#{db.port}/#{db.name}"
    end

    def conn_opts(%__MODULE__{} = db, opts \\ []) do
      pool_size = Keyword.get(opts, :pool_size, db.pool_size) || 10

      [
        hostname: db.host,
        port: db.port,
        username: db.user,
        password: db.password,
        database: db.name,
        pool_size: pool_size
      ]
    end
  end

  defmodule Storage do
    defstruct driver: "local", local_path: "./uploads", max_file_size: 10_485_760
  end

  defmodule Instrumentation do
    defstruct enabled: true, retention_days: 7, sampling_rate: 1.0, buffer_size: 500, flush_interval_ms: 100
  end

  def load(path \\ "app.yaml") do
    yaml = YamlElixir.read_from_file!(path)

    db = yaml["database"] || %{}
    storage = yaml["storage"] || %{}
    server = yaml["server"] || %{}
    instr = yaml["instrumentation"] || %{}

    %__MODULE__{
      server_port: server["port"] || 8080,
      jwt_secret: yaml["jwt_secret"] || "changeme-secret",
      platform_jwt_secret: yaml["platform_jwt_secret"] || "changeme-platform-secret",
      app_pool_size: yaml["app_pool_size"] || 5,
      database: %Database{
        driver: db["driver"] || "postgres",
        data_dir: db["data_dir"] || "./data",
        host: db["host"] || "localhost",
        port: db["port"] || 5433,
        user: db["user"] || "rocket",
        password: db["password"] || "rocket",
        name: db["name"] || "rocket",
        pool_size: db["pool_size"] || 10
      },
      storage: %Storage{
        driver: storage["driver"] || "local",
        local_path: storage["local_path"] || "./uploads",
        max_file_size: storage["max_file_size"] || 10_485_760
      },
      instrumentation: %Instrumentation{
        enabled: Map.get(instr, "enabled", true),
        retention_days: instr["retention_days"] || 7,
        sampling_rate: instr["sampling_rate"] || 1.0,
        buffer_size: instr["buffer_size"] || 500,
        flush_interval_ms: instr["flush_interval_ms"] || 100
      }
    }
  end
end
