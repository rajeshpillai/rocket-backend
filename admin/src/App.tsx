import { type ParentProps } from "solid-js";
import { Router, Route, Navigate, useLocation, useNavigate } from "@solidjs/router";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { AppsList } from "./pages/AppsList";
import { EntitiesList } from "./pages/EntitiesList";
import { EntityDetail } from "./pages/EntityDetail";
import { RelationsList } from "./pages/RelationsList";
import { RulesList } from "./pages/RulesList";
import { StateMachinesList } from "./pages/StateMachinesList";
import { WorkflowsList } from "./pages/WorkflowsList";
import { WorkflowMonitor } from "./pages/WorkflowMonitor";
import { DataBrowser } from "./pages/DataBrowser";
import { UsersList } from "./pages/UsersList";
import { PermissionsList } from "./pages/PermissionsList";
import { WebhooksList } from "./pages/WebhooksList";
import { WebhookLogs } from "./pages/WebhookLogs";
import { isAuthenticated } from "./stores/auth";
import { selectedApp } from "./stores/app";
import { ToastContainer } from "./components/Toast";

const APP_FREE_PATHS = ["/admin/login", "/admin/apps", "/admin/", "/admin"];

function AppRoot(props: ParentProps) {
  const location = useLocation();
  const navigate = useNavigate();

  // Login page renders without layout
  if (location.pathname === "/admin/login") {
    if (isAuthenticated()) {
      navigate("/apps", { replace: true });
      return null;
    }
    return (
      <>
        {props.children}
        <ToastContainer />
      </>
    );
  }

  // Protected routes: redirect to login if not authenticated
  if (!isAuthenticated()) {
    navigate("/login", { replace: true });
    return null;
  }

  // App-scoped routes: redirect to /apps if no app is selected
  if (!selectedApp() && !APP_FREE_PATHS.includes(location.pathname)) {
    navigate("/apps", { replace: true });
    return null;
  }

  return <Layout>{props.children}</Layout>;
}

export function App() {
  return (
    <Router base="/admin" root={AppRoot}>
      <Route path="/login" component={Login} />
      <Route path="/" component={() => <Navigate href="/admin/apps" />} />
      <Route path="/apps" component={AppsList} />
      <Route path="/entities" component={EntitiesList} />
      <Route path="/entities/new" component={EntityDetail} />
      <Route path="/entities/:name" component={EntityDetail} />
      <Route path="/relations" component={RelationsList} />
      <Route path="/rules" component={RulesList} />
      <Route path="/state-machines" component={StateMachinesList} />
      <Route path="/workflows" component={WorkflowsList} />
      <Route path="/workflow-monitor" component={WorkflowMonitor} />
      <Route path="/data" component={DataBrowser} />
      <Route path="/data/:entity" component={DataBrowser} />
      <Route path="/users" component={UsersList} />
      <Route path="/permissions" component={PermissionsList} />
      <Route path="/webhooks" component={WebhooksList} />
      <Route path="/webhook-logs" component={WebhookLogs} />
    </Router>
  );
}
