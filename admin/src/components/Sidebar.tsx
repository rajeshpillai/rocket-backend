import { A, useLocation } from "@solidjs/router";

const navItems = [
  { href: "/entities", label: "Entities", icon: "□" },
  { href: "/relations", label: "Relations", icon: "⇄" },
  { href: "/rules", label: "Rules", icon: "✓" },
  { href: "/state-machines", label: "State Machines", icon: "⇆" },
  { href: "/workflows", label: "Workflows", icon: "⟳" },
  { href: "/workflow-monitor", label: "Workflow Monitor", icon: "▶" },
  { href: "/data", label: "Data Browser", icon: "▤" },
];

export function Sidebar() {
  const location = useLocation();

  const isActive = (href: string) => location.pathname.startsWith(`/admin${href}`);

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
    </aside>
  );
}
