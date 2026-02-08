import Config

config :rocket, Rocket.Repo,
  username: "rocket",
  password: "rocket",
  hostname: "localhost",
  database: "rocket",
  port: 5433,
  stacktrace: true,
  show_sensitive_data_on_connection_error: true,
  pool_size: 10

config :rocket, RocketWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 8080],
  check_origin: false,
  code_reloader: false,
  debug_errors: true,
  secret_key_base: "dev-only-secret-key-base-that-is-at-least-64-bytes-long-for-phoenix",
  watchers: []

config :rocket, :jwt_secret, "rocket-dev-secret"
config :rocket, :platform_jwt_secret, "rocket-platform-secret"

config :logger, :default_formatter, format: "[$level] $message\n"

config :phoenix, :stacktrace_depth, 20
config :phoenix, :plug_init_mode, :runtime
