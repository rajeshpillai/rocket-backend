import { type ParentProps, Show, createEffect } from "solid-js";
import { Router, Route, Navigate, useLocation, useNavigate } from "@solidjs/router";
import { Layout } from "./components/layout";
import { Login } from "./pages/login";
import { AppsList } from "./pages/apps-list";
import { EntitiesList } from "./pages/entities-list";
import { EntityDetail } from "./pages/entity-detail";
import { RelationsList } from "./pages/relations-list";
import { RulesList } from "./pages/rules-list";
import { StateMachinesList } from "./pages/state-machines-list";
import { WorkflowsList } from "./pages/workflows-list";
import { WorkflowMonitor } from "./pages/workflow-monitor";
import { DataBrowser } from "./pages/data-browser";
import { UsersList } from "./pages/users-list";
import { PermissionsList } from "./pages/permissions-list";
import { WebhooksList } from "./pages/webhooks-list";
import { WebhookLogs } from "./pages/webhook-logs";
import { UIConfigList } from "./pages/ui-config-list";
import { ERD } from "./pages/erd";
import { HelpIndex } from "./pages/help-docs/help-index";
import { HelpTopicPage } from "./pages/help-docs/help-layout";
import { isAuthenticated } from "./stores/auth";
import { selectedApp } from "./stores/app";
import { ToastContainer } from "./components/toast";

const APP_FREE_PATHS = ["/admin/login", "/admin/apps", "/admin/", "/admin"];

function AppRoot(props: ParentProps) {
  const location = useLocation();
  const navigate = useNavigate();

  // Reactive redirects — re-evaluate whenever path, auth, or app changes
  createEffect(() => {
    const path = location.pathname;
    if (path === "/admin/login") {
      if (isAuthenticated()) navigate("/apps", { replace: true });
      return;
    }
    if (!isAuthenticated()) {
      navigate("/login", { replace: true });
      return;
    }
    if (!selectedApp() && !APP_FREE_PATHS.includes(path) && !path.startsWith("/admin/help")) {
      navigate("/apps", { replace: true });
    }
  });

  // Reactive rendering — Show components re-evaluate when signals change
  return (
    <Show
      when={location.pathname !== "/admin/login"}
      fallback={<>{props.children}<ToastContainer /></>}
    >
      <Show when={isAuthenticated()} fallback={null}>
        <Layout>{props.children}</Layout>
      </Show>
    </Show>
  );
}

export function App() {
  return (
    <Router base="/admin" root={AppRoot}>
      <Route path="/login" component={Login} />
      <Route path="/" component={() => <Navigate href="/apps" />} />
      <Route path="/apps" component={AppsList} />
      <Route path="/entities" component={EntitiesList} />
      <Route path="/entities/new" component={EntityDetail} />
      <Route path="/entities/:name" component={EntityDetail} />
      <Route path="/relations" component={RelationsList} />
      <Route path="/erd" component={ERD} />
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
      <Route path="/ui-configs" component={UIConfigList} />
      <Route path="/help" component={HelpIndex} />
      <Route path="/help/:topic" component={HelpTopicPage} />
    </Router>
  );
}
