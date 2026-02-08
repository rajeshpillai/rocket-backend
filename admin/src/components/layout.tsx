import type { ParentProps } from "solid-js";
import { Sidebar, sidebarCollapsed } from "./sidebar";
import { StatusBar } from "./status-bar";
import { ToastContainer } from "./toast";

export function Layout(props: ParentProps) {
  return (
    <div class="app-layout">
      <Sidebar />
      <main class={`content-area ${sidebarCollapsed() ? "content-area-collapsed" : ""}`}>
        {props.children}
      </main>
      <StatusBar />
      <ToastContainer />
    </div>
  );
}
