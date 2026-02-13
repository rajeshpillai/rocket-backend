import { createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { platformLogin } from "../api/platform";
import { setPlatformTokens } from "../stores/auth";
import { isApiError } from "../types/api";
import ToastContainer from "../components/toast";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal("platform@localhost");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await platformLogin(email(), password());
      setPlatformTokens(result.access_token, result.refresh_token);
      navigate("/apps");
    } catch (err) {
      if (isApiError(err)) {
        setError(err.error.message);
      } else {
        setError("Login failed. Please check your credentials.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="login-container">
      <div class="login-card">
        <div class="login-logo">
          <div class="login-logo-icon">R</div>
          <span class="login-logo-text">Rocket</span>
        </div>

        <h1 class="login-title">Platform Login</h1>
        <p class="login-subtitle">
          Sign in with your platform credentials
        </p>

        {error() && <div class="login-error">{error()}</div>}

        <form class="login-form" onSubmit={handleSubmit}>
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
              placeholder="Enter your password"
              required
            />
          </div>

          <button
            type="submit"
            class="btn-primary login-btn"
            disabled={loading()}
          >
            {loading() ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
      <ToastContainer />
    </div>
  );
}
