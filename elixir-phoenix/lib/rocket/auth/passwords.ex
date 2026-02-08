defmodule Rocket.Auth.Passwords do
  @moduledoc "bcrypt password hashing and verification."

  @doc "Hash a plaintext password using bcrypt."
  def hash_password(password) do
    Bcrypt.hash_pwd_salt(password)
  end

  @doc "Check a plaintext password against a bcrypt hash."
  def check_password(password, hash) do
    Bcrypt.verify_pass(password, hash)
  end
end
