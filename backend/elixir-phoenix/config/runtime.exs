import Config

if System.get_env("PHX_SERVER") do
  config :rocket, RocketWeb.Endpoint, server: true
end

if config_env() == :prod do
  config :rocket, Rocket.Repo,
    username: System.get_env("DB_USER") || "rocket",
    password: System.get_env("DB_PASSWORD") || "rocket",
    hostname: System.get_env("DB_HOST") || "localhost",
    database: System.get_env("DB_NAME") || "rocket",
    port: String.to_integer(System.get_env("DB_PORT") || "5433"),
    pool_size: String.to_integer(System.get_env("DB_POOL_SIZE") || "10")

  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise "SECRET_KEY_BASE not set"

  port = String.to_integer(System.get_env("PORT") || "8080")

  config :rocket, RocketWeb.Endpoint,
    url: [host: System.get_env("PHX_HOST") || "localhost", port: 443, scheme: "https"],
    http: [ip: {0, 0, 0, 0}, port: port],
    secret_key_base: secret_key_base
end
