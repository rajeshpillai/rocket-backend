defmodule RocketWeb.Router do
  use RocketWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :platform_auth do
    plug RocketWeb.Plugs.PlatformAuthPlug
  end

  pipeline :app_resolver do
    plug RocketWeb.Plugs.AppResolverPlug
  end

  pipeline :dual_auth do
    plug RocketWeb.Plugs.DualAuthPlug
  end

  pipeline :admin_only do
    plug RocketWeb.Plugs.AdminOnlyPlug
  end

  # Health check — no auth
  scope "/", RocketWeb do
    pipe_through :api
    get "/health", HealthController, :index
  end

  # ── Platform routes ──

  # Platform auth — no token required
  scope "/api/_platform/auth", RocketWeb do
    pipe_through :api

    post "/login", PlatformController, :login
    post "/refresh", PlatformController, :refresh
    post "/logout", PlatformController, :logout
  end

  # Platform management — require platform auth
  scope "/api/_platform", RocketWeb do
    pipe_through [:api, :platform_auth]

    get "/apps", PlatformController, :list_apps
    post "/apps", PlatformController, :create_app
    get "/apps/:name", PlatformController, :get_app
    delete "/apps/:name", PlatformController, :delete_app
  end

  # ── App-scoped routes ──

  # App auth — no token required (app resolver only)
  scope "/api/:app/auth", RocketWeb do
    pipe_through [:api, :app_resolver]

    post "/login", AuthController, :login
    post "/refresh", AuthController, :refresh
    post "/logout", AuthController, :logout
  end

  # App admin — require app resolver + dual auth + admin
  scope "/api/:app/_admin", RocketWeb do
    pipe_through [:api, :app_resolver, :dual_auth, :admin_only]

    # Entities
    get "/entities", AdminController, :list_entities
    post "/entities", AdminController, :create_entity
    get "/entities/:name", AdminController, :get_entity
    put "/entities/:name", AdminController, :update_entity
    delete "/entities/:name", AdminController, :delete_entity

    # Relations
    get "/relations", AdminController, :list_relations
    post "/relations", AdminController, :create_relation
    get "/relations/:name", AdminController, :get_relation
    put "/relations/:name", AdminController, :update_relation
    delete "/relations/:name", AdminController, :delete_relation

    # Rules
    get "/rules", AdminController, :list_rules
    post "/rules", AdminController, :create_rule
    get "/rules/:id", AdminController, :get_rule
    put "/rules/:id", AdminController, :update_rule
    delete "/rules/:id", AdminController, :delete_rule

    # State Machines
    get "/state-machines", AdminController, :list_state_machines
    post "/state-machines", AdminController, :create_state_machine
    get "/state-machines/:id", AdminController, :get_state_machine
    put "/state-machines/:id", AdminController, :update_state_machine
    delete "/state-machines/:id", AdminController, :delete_state_machine

    # Workflows
    get "/workflows", AdminController, :list_workflows
    post "/workflows", AdminController, :create_workflow
    get "/workflows/:id", AdminController, :get_workflow
    put "/workflows/:id", AdminController, :update_workflow
    delete "/workflows/:id", AdminController, :delete_workflow

    # Users
    get "/users", AdminController, :list_users
    post "/users", AdminController, :create_user
    get "/users/:id", AdminController, :get_user
    put "/users/:id", AdminController, :update_user
    delete "/users/:id", AdminController, :delete_user

    # Permissions
    get "/permissions", AdminController, :list_permissions
    post "/permissions", AdminController, :create_permission
    get "/permissions/:id", AdminController, :get_permission
    put "/permissions/:id", AdminController, :update_permission
    delete "/permissions/:id", AdminController, :delete_permission

    # Webhooks
    get "/webhooks", AdminController, :list_webhooks
    post "/webhooks", AdminController, :create_webhook
    get "/webhooks/:id", AdminController, :get_webhook
    put "/webhooks/:id", AdminController, :update_webhook
    delete "/webhooks/:id", AdminController, :delete_webhook

    # Webhook Logs
    get "/webhook-logs", AdminController, :list_webhook_logs
    get "/webhook-logs/:id", AdminController, :get_webhook_log
    post "/webhook-logs/:id/retry", AdminController, :retry_webhook_log

    # Export/Import
    get "/export", AdminController, :export
    post "/import", AdminController, :import_schema
  end

  # Workflow runtime — require app resolver + dual auth
  scope "/api/:app/_workflows", RocketWeb do
    pipe_through [:api, :app_resolver, :dual_auth]

    get "/pending", WorkflowController, :pending
    get "/:id", WorkflowController, :get_instance
    post "/:id/approve", WorkflowController, :approve
    post "/:id/reject", WorkflowController, :reject
  end

  # File endpoints — require app resolver + dual auth
  scope "/api/:app/_files", RocketWeb do
    pipe_through [:api, :app_resolver, :dual_auth]

    post "/upload", FileController, :upload
    get "/:id", FileController, :serve
    delete "/:id", FileController, :delete_file
    get "/", FileController, :list_files
  end

  # Dynamic entity routes — require app resolver + dual auth
  scope "/api/:app", RocketWeb do
    pipe_through [:api, :app_resolver, :dual_auth]

    get "/:entity", EngineController, :list
    get "/:entity/:id", EngineController, :get
    post "/:entity", EngineController, :create
    put "/:entity/:id", EngineController, :update
    delete "/:entity/:id", EngineController, :delete
  end
end
