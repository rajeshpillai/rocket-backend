import type { ParentProps } from "solid-js";
import { Sidebar } from "./Sidebar";
import { ToastContainer } from "./Toast";

export function Layout(props: ParentProps) {
  return (
    <div class="app-layout">
      <Sidebar />
      <main class="content-area">{props.children}</main>
      <ToastContainer />
    </div>
  );
}
