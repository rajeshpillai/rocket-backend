import { createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { setTokens } from "../stores/auth";
import { platformLogin } from "../api/platform";
import { isApiError } from "../types/api";

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const resp = await platformLogin(email(), password());
      setTokens(resp.data.access_token, resp.data.refresh_token);
      navigate("/apps", { replace: true });
    } catch (err) {
      if (isApiError(err)) {
        setError(err.error.message);
      } else {
        setError("Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="login-container">
      <div class="login-card">
        <h1 class="login-title">Rocket Admin</h1>
        <p class="login-subtitle">Sign in to your platform account</p>

        {error() && (
          <div class="login-error">{error()}</div>
        )}

        <form onSubmit={handleSubmit} class="login-form">
          <div class="form-group">
            <label class="form-label" for="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              class="form-input"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              placeholder="platform@localhost"
              required
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              class="form-input"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              placeholder="Password"
              required
            />
          </div>

          <button
            type="submit"
            class="btn-primary login-btn"
            disabled={loading()}
          >
            {loading() ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
