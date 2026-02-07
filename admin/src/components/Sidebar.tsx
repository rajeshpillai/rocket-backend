import { A, useLocation, useNavigate } from "@solidjs/router";
import { clearAuth, getRefreshToken, parseTokenPayload } from "../stores/auth";
import { post } from "../api/client";

const navItems = [
  { href: "/entities", label: "Entities", icon: "□" },
  { href: "/relations", label: "Relations", icon: "⇄" },
  { href: "/rules", label: "Rules", icon: "✓" },
  { href: "/state-machines", label: "State Machines", icon: "⇆" },
  { href: "/workflows", label: "Workflows", icon: "⟳" },
  { href: "/workflow-monitor", label: "Workflow Monitor", icon: "▶" },
  { href: "/data", label: "Data Browser", icon: "▤" },
  { href: "/users", label: "Users", icon: "👤" },
  { href: "/permissions", label: "Permissions", icon: "🔒" },
  { href: "/webhooks", label: "Webhooks", icon: "🔗" },
  { href: "/webhook-logs", label: "Webhook Logs", icon: "📋" },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (href: string) => location.pathname.startsWith(`/admin${href}`);

  const payload = () => parseTokenPayload();
  const userEmail = () => payload()?.sub ?? "";

  const handleLogout = async () => {
    const refresh = getRefreshToken();
    if (refresh) {
      try {
        await post("/auth/logout", { refresh_token: refresh });
      } catch {
        // Ignore errors on logout
      }
    }
    clearAuth();
    navigate("/login", { replace: true });
  };

  return (
    <aside class="sidebar">
      <div class="sidebar-title">Rocket Admin</div>
      <nav class="sidebar-nav">
        {navItems.map((item) => (
          <A
            href={item.href}
            class={`nav-link ${isActive(item.href) ? "nav-link-active" : ""}`}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </A>
        ))}
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-user" title={userEmail()}>
          {userEmail()}
        </div>
        <button class="btn-secondary btn-sm sidebar-logout" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </aside>
  );
}
