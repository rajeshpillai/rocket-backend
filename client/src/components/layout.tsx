import { type ParentProps } from "solid-js";
import Sidebar, { sidebarCollapsed } from "./sidebar";
import ToastContainer from "./toast";

export default function Layout(props: ParentProps) {
  return (
    <div class="app-layout">
      <Sidebar />
      <main
        class={`content-area ${sidebarCollapsed() ? "content-area-collapsed" : ""}`}
      >
        {props.children}
      </main>
      <div
        class={`status-bar ${sidebarCollapsed() ? "status-bar-collapsed" : ""}`}
      >
        <span class="status-bar-version">Rocket Client v{__APP_VERSION__}</span>
      </div>
      <ToastContainer />
    </div>
  );
}
