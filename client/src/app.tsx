import { Router, Route, Navigate, useNavigate, useLocation } from "@solidjs/router";
import { createEffect, type ParentProps } from "solid-js";
import { isPlatformAuthenticated } from "./stores/auth";
import { isAppAuthenticated } from "./stores/app-auth";
import { selectedApp, isFixedApp } from "./stores/app";
import { getAllUIConfigs } from "./stores/ui-config";
import Layout from "./components/layout";
import PublicLayout from "./components/public-layout";
import LoginPage from "./pages/login";
import AppsPage from "./pages/apps";
import AppLoginPage from "./pages/app-login";
import DashboardPage from "./pages/dashboard";
import EntityListPage from "./pages/entity-list";
import EntityDetailPage from "./pages/entity-detail";
import PublicLandingPage from "./pages/public/entity-landing";
import PublicDetailPage from "./pages/public/entity-detail";

function AuthGuard(props: ParentProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const publicPaths = ["/login", "/apps", "/app-login", "/pages"];

  createEffect(() => {
    const path = location.pathname;
    const isPublic = publicPaths.some(
      (p) => path === p || path.startsWith(p + "/")
    );

    if (isPublic) return;

    // When app is fixed via VITE_FIXED_APP, skip platform login and app selection
    if (isFixedApp()) {
      if (!isAppAuthenticated()) {
        navigate("/app-login");
      }
      return;
    }

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

function PublicPageLayout(props: ParentProps) {
  return (
    <PublicLayout>
      {props.children}
    </PublicLayout>
  );
}

function DefaultRedirect() {
  if (isFixedApp()) {
    return <Navigate href="/pages" />;
  }
  return <Navigate href="/login" />;
}

function PagesIndex() {
  const configs = getAllUIConfigs();
  for (const row of configs) {
    if (row.config?.pages?.landing) {
      return <Navigate href={`/pages/${row.entity}`} />;
    }
  }
  return <Navigate href="/dashboard" />;
}

export default function App() {
  return (
    <Router root={AuthGuard}>
      <Route path="/login" component={LoginPage} />
      <Route path="/apps" component={AppsPage} />
      <Route path="/app-login" component={AppLoginPage} />

      {/* Public pages - no auth required but needs app selected */}
      <Route path="/pages" component={PublicPageLayout}>
        <Route path="/" component={PagesIndex} />
        <Route path="/:entity" component={PublicLandingPage} />
        <Route path="/:entity/:id" component={PublicDetailPage} />
      </Route>

      {/* Admin pages - auth required */}
      <Route path="/" component={AppLayout}>
        <Route path="/dashboard" component={DashboardPage} />
        <Route path="/data/:entity" component={EntityListPage} />
        <Route path="/data/:entity/:id" component={EntityDetailPage} />
        <Route path="/" component={() => <Navigate href="/dashboard" />} />
      </Route>

      <Route path="*" component={DefaultRedirect} />
    </Router>
  );
}
