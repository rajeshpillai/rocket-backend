import { type ParentProps } from "solid-js";
import { A } from "@solidjs/router";
import ToastContainer from "./toast";

interface PublicLayoutProps extends ParentProps {
  siteName?: string;
}

export default function PublicLayout(props: PublicLayoutProps) {
  return (
    <div class="public-layout">
      <header class="public-header">
        <div class="public-header-inner">
          <A href="/pages/post" class="public-logo">
            {props.siteName ?? "Blog"}
          </A>
          <nav class="public-nav">
            <A href="/pages/post" class="public-nav-link">
              Articles
            </A>
            <A href="/dashboard" class="public-nav-link">
              Admin
            </A>
          </nav>
        </div>
      </header>

      <main class="public-main">
        {props.children}
      </main>

      <footer class="public-footer">
        <div class="public-footer-inner">
          <p>Powered by Rocket Backend</p>
        </div>
      </footer>

      <ToastContainer />
    </div>
  );
}
