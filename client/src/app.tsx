import { Router, Route, Navigate, useNavigate, useLocation } from "@solidjs/router";
import { createEffect, type ParentProps } from "solid-js";
import { isPlatformAuthenticated } from "./stores/auth";
import { isAppAuthenticated } from "./stores/app-auth";
import { selectedApp } from "./stores/app";
import Layout from "./components/layout";
import LoginPage from "./pages/login";
import AppsPage from "./pages/apps";
import AppLoginPage from "./pages/app-login";
import DashboardPage from "./pages/dashboard";
import EntityListPage from "./pages/entity-list";
import EntityDetailPage from "./pages/entity-detail";

function AuthGuard(props: ParentProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const publicPaths = ["/login", "/apps", "/app-login"];

  createEffect(() => {
    const path = location.pathname;
    const isPublic = publicPaths.some(
      (p) => path === p || path.startsWith(p + "/")
    );

    if (isPublic) return;

    if (!isPlatformAuthenticated()) {
      navigate("/login");
      return;
    }

    if (!selectedApp()) {
      navigate("/apps");
      return;
    }

    if (!isAppAuthenticated()) {
      navigate("/app-login");
      return;
    }
  });

  return <>{props.children}</>;
}

function AppLayout(props: ParentProps) {
  return (
    <Layout>
      {props.children}
    </Layout>
  );
}

export default function App() {
  return (
    <Router root={AuthGuard}>
      <Route path="/login" component={LoginPage} />
      <Route path="/apps" component={AppsPage} />
      <Route path="/app-login" component={AppLoginPage} />

      <Route path="/" component={AppLayout}>
        <Route path="/dashboard" component={DashboardPage} />
        <Route path="/data/:entity" component={EntityListPage} />
        <Route path="/data/:entity/:id" component={EntityDetailPage} />
        <Route path="/" component={() => <Navigate href="/dashboard" />} />
      </Route>

      <Route path="*" component={() => <Navigate href="/login" />} />
    </Router>
  );
}
