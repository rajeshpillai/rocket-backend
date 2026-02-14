defmodule Rocket.Instrument.Instrumenter do
  @moduledoc """
  Core instrumentation module. Uses Process dictionary for trace context propagation.

  Trace context keys stored in Process dictionary:
    :rocket_trace_id       - UUID string
    :rocket_parent_span_id - UUID string or nil
    :rocket_user_id        - UUID string or nil
    :rocket_buffer         - pid of the EventBuffer GenServer
    :rocket_instrumenter   - :active | :noop
  """

  @doc "Set up trace context for the current process."
  def init_trace_context(trace_id, buffer_pid, user_id \\ nil) do
    Process.put(:rocket_trace_id, trace_id)
    Process.put(:rocket_parent_span_id, nil)
    Process.put(:rocket_user_id, user_id)
    Process.put(:rocket_buffer, buffer_pid)
    Process.put(:rocket_instrumenter, :active)
    :ok
  end

  @doc "Set up a noop trace context (when instrumentation is disabled or sampled out)."
  def init_noop_context do
    Process.put(:rocket_instrumenter, :noop)
    :ok
  end

  @doc "Returns true if the current process has active instrumentation."
  def active? do
    Process.get(:rocket_instrumenter) == :active
  end

  @doc "Get current trace ID."
  def get_trace_id, do: Process.get(:rocket_trace_id)

  @doc "Set user ID in trace context."
  def set_user_id(user_id) do
    Process.put(:rocket_user_id, user_id)
  end

  @doc """
  Start a new span. Returns a span map that must be passed to end_span/1.
  Automatically becomes a child of the current parent span.
  """
  def start_span(source, component, action) do
    if active?() do
      span_id = Ecto.UUID.generate()
      parent_span_id = Process.get(:rocket_parent_span_id)
      trace_id = Process.get(:rocket_trace_id)
      user_id = Process.get(:rocket_user_id)
      buffer = Process.get(:rocket_buffer)

      # Update parent_span_id so subsequent spans become children of this one
      Process.put(:rocket_parent_span_id, span_id)

      %{
        trace_id: trace_id,
        span_id: span_id,
        parent_span_id: parent_span_id,
        source: source,
        component: component,
        action: action,
        user_id: user_id,
        buffer: buffer,
        start_time: System.monotonic_time(:microsecond),
        entity: nil,
        record_id: nil,
        status: nil,
        metadata: %{},
        ended: false
      }
    else
      :noop
    end
  end

  @doc "Set entity and optional record_id on a span."
  def set_entity(span, entity, record_id \\ nil)
  def set_entity(:noop, _entity, _record_id), do: :noop

  def set_entity(span, entity, record_id) do
    %{span | entity: entity, record_id: record_id}
  end

  @doc "Set status on a span."
  def set_status(:noop, _status), do: :noop
  def set_status(span, status), do: %{span | status: status}

  @doc "Add metadata to a span."
  def set_metadata(:noop, _key, _value), do: :noop

  def set_metadata(span, key, value) do
    %{span | metadata: Map.put(span.metadata, key, value)}
  end

  @doc "End a span, compute duration, and enqueue to buffer."
  def end_span(:noop), do: :ok

  def end_span(%{ended: true}), do: :ok

  def end_span(span) do
    duration_us = System.monotonic_time(:microsecond) - span.start_time
    duration_ms = Float.round(duration_us / 1000.0, 2)

    event = %{
      trace_id: span.trace_id,
      span_id: span.span_id,
      parent_span_id: span.parent_span_id,
      event_type: "system",
      source: span.source,
      component: span.component,
      action: span.action,
      entity: span.entity,
      record_id: span.record_id,
      user_id: span.user_id,
      duration_ms: duration_ms,
      status: span.status,
      metadata: if(map_size(span.metadata) > 0, do: span.metadata, else: nil)
    }

    if span.buffer && Process.alive?(span.buffer) do
      Rocket.Instrument.EventBuffer.enqueue(span.buffer, event)
    end

    :ok
  end

  @doc "Emit a business event (no duration tracking)."
  def emit_business_event(action, entity, record_id, metadata \\ nil) do
    if active?() do
      trace_id = Process.get(:rocket_trace_id)
      span_id = Ecto.UUID.generate()
      parent_span_id = Process.get(:rocket_parent_span_id)
      user_id = Process.get(:rocket_user_id)
      buffer = Process.get(:rocket_buffer)

      event = %{
        trace_id: trace_id,
        span_id: span_id,
        parent_span_id: parent_span_id,
        event_type: "business",
        source: "app",
        component: "engine",
        action: action,
        entity: entity,
        record_id: record_id,
        user_id: user_id,
        duration_ms: nil,
        status: nil,
        metadata: metadata
      }

      if buffer && Process.alive?(buffer) do
        Rocket.Instrument.EventBuffer.enqueue(buffer, event)
      end
    end

    :ok
  end
end
