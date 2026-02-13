import { createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { appLogin } from "../api/data";
import { setAppTokens } from "../stores/app-auth";
import { selectedApp, setSelectedApp } from "../stores/app";
import { isApiError } from "../types/api";
import ToastContainer from "../components/toast";

export default function AppLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal("admin@localhost");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);

  function handleBack() {
    setSelectedApp(null);
    navigate("/apps");
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await appLogin(email(), password());
      setAppTokens(result.access_token, result.refresh_token);
      navigate("/dashboard");
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

        <h1 class="login-title">App Login</h1>
        <p class="login-subtitle">
          Sign in to{" "}
          <strong>{selectedApp() || "app"}</strong>
        </p>

        <Show when={error()}>
          <div class="login-error">{error()}</div>
        </Show>

        <form class="login-form" onSubmit={handleSubmit}>
          <div class="form-group">
            <label class="form-label" for="app-email">
              Email
            </label>
            <input
              id="app-email"
              type="email"
              class="form-input"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              placeholder="admin@localhost"
              required
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="app-password">
              Password
            </label>
            <input
              id="app-password"
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

        <div style={{ "margin-top": "16px", "text-align": "center" }}>
          <button class="btn-ghost btn-sm" onClick={handleBack}>
            Back to Apps
          </button>
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}
