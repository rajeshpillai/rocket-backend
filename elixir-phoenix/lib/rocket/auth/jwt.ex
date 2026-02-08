defmodule Rocket.Auth.JWT do
  @moduledoc "JWT HS256 token generation and verification using Joken."

  @access_ttl 15 * 60
  @refresh_ttl 7 * 24 * 3600

  @doc "Generate an access token (JWT HS256, 15min TTL)."
  def generate_access_token(user_id, roles, secret) do
    now = DateTime.utc_now() |> DateTime.to_unix()

    claims = %{
      "sub" => user_id,
      "roles" => roles,
      "iat" => now,
      "exp" => now + @access_ttl
    }

    signer = Joken.Signer.create("HS256", secret)

    case Joken.encode_and_sign(claims, signer) do
      {:ok, token, _claims} -> {:ok, token}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "Parse and verify an access token. Returns {:ok, claims} or {:error, reason}."
  def parse_access_token(token, secret) do
    signer = Joken.Signer.create("HS256", secret)

    case Joken.verify(token, signer) do
      {:ok, claims} ->
        exp = claims["exp"]

        if exp && DateTime.utc_now() |> DateTime.to_unix() > exp do
          {:error, "token expired"}
        else
          {:ok, claims}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc "Generate an opaque refresh token (UUID v4)."
  def generate_refresh_token do
    Ecto.UUID.generate()
  end

  @doc "Refresh token TTL in seconds (7 days)."
  def refresh_ttl, do: @refresh_ttl
end
