import { Router, Route, Navigate } from "@solidjs/router";
import { Layout } from "./components/Layout";
import { EntitiesList } from "./pages/EntitiesList";
import { EntityDetail } from "./pages/EntityDetail";
import { RelationsList } from "./pages/RelationsList";
import { RulesList } from "./pages/RulesList";
import { DataBrowser } from "./pages/DataBrowser";

export function App() {
  return (
    <Router base="/admin" root={Layout}>
      <Route path="/" component={() => <Navigate href="/admin/entities" />} />
      <Route path="/entities" component={EntitiesList} />
      <Route path="/entities/new" component={EntityDetail} />
      <Route path="/entities/:name" component={EntityDetail} />
      <Route path="/relations" component={RelationsList} />
      <Route path="/rules" component={RulesList} />
      <Route path="/data" component={DataBrowser} />
      <Route path="/data/:entity" component={DataBrowser} />
    </Router>
  );
}
