defmodule RocketWeb.Plugs.InstrumentationPlug do
  @moduledoc "Plug that sets up trace context and creates a root HTTP span."
  import Plug.Conn

  alias Rocket.Instrument.Instrumenter

  def init(opts), do: opts

  def call(conn, _opts) do
    cfg = Application.get_env(:rocket, :instrumentation_config) || %{enabled: true, sampling_rate: 1.0}

    if !cfg.enabled do
      Instrumenter.init_noop_context()
      conn
    else
      # Sampling
      if cfg.sampling_rate < 1.0 && :rand.uniform() > cfg.sampling_rate do
        Instrumenter.init_noop_context()
        conn
      else
        # Get or generate trace ID
        trace_id =
          case get_req_header(conn, "x-trace-id") do
            [tid | _] when byte_size(tid) > 0 -> tid
            _ -> Ecto.UUID.generate()
          end

        # Get event buffer from app context
        buffer =
          case conn.assigns[:app_context] do
            %{event_buffer: buf} when is_pid(buf) -> buf
            _ -> nil
          end

        if buffer == nil do
          Instrumenter.init_noop_context()
          conn
        else
          # Get user_id if already available
          user_id =
            case conn.assigns[:current_user] do
              %{"id" => id} -> id
              %{id: id} -> id
              _ -> nil
            end

          Instrumenter.init_trace_context(trace_id, buffer, user_id)

          # Start root HTTP span
          span = Instrumenter.start_span("http", "handler", "request.start")
          span = Instrumenter.set_metadata(span, "method", conn.method)
          path = conn.request_path |> String.split("?") |> hd()
          span = Instrumenter.set_metadata(span, "path", path)

          # Set response header and register before_send to end span
          conn
          |> put_resp_header("x-trace-id", trace_id)
          |> assign(:root_span, span)
          |> register_before_send(fn conn ->
            span = conn.assigns[:root_span]

            if span && span != :noop do
              span = Instrumenter.set_metadata(span, "status_code", conn.status)
              span = if conn.status >= 400, do: Instrumenter.set_status(span, "error"), else: Instrumenter.set_status(span, "ok")
              Instrumenter.end_span(span)
            end

            conn
          end)
        end
      end
    end
  end
end
