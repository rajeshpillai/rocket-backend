import type { ParentProps } from "solid-js";
import { Sidebar } from "./sidebar";
import { ToastContainer } from "./toast";

export function Layout(props: ParentProps) {
  return (
    <div class="app-layout">
      <Sidebar />
      <main class="content-area">{props.children}</main>
      <ToastContainer />
    </div>
  );
}
