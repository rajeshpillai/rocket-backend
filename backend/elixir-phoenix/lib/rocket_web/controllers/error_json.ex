defmodule RocketWeb.ErrorJSON do
  @moduledoc "Renders JSON errors in Rocket's standard format."

  def render("404.json", _assigns) do
    %{error: %{code: "NOT_FOUND", message: "Not Found"}}
  end

  def render("500.json", _assigns) do
    %{error: %{code: "INTERNAL_ERROR", message: "Internal Server Error"}}
  end

  def render(template, _assigns) do
    %{error: %{code: "INTERNAL_ERROR", message: Phoenix.Controller.status_message_from_template(template)}}
  end
end
