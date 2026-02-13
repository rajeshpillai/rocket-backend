import { type ParentProps, For, createMemo } from "solid-js";
import { A, useLocation } from "@solidjs/router";
import { getEntityUIConfig, getAllUIConfigs } from "../stores/ui-config";
import { selectedApp, isFixedApp } from "../stores/app";
import ToastContainer from "./toast";

interface PublicLayoutProps extends ParentProps {
  siteName?: string;
}

export default function PublicLayout(props: PublicLayoutProps) {
  const location = useLocation();

  const publicNavLinks = createMemo(() => {
    const configs = getAllUIConfigs();
    const links: { label: string; route: string }[] = [];
    for (const row of configs) {
      const cfg = row.config;
      if (cfg?.pages?.landing) {
        links.push({
          label: cfg.pages.landing.title ?? cfg.sidebar?.label ?? row.entity,
          route: `/pages/${row.entity}`,
        });
      }
    }
    return links;
  });

  const currentEntity = createMemo(() => {
    const match = location.pathname.match(/^\/pages\/([^/]+)/);
    return match ? match[1] : null;
  });

  const envSiteName = (import.meta.env.VITE_SITE_NAME as string) || null;

  const siteName = createMemo(() => {
    // For fixed-app deployments, use env site name or app name as consistent branding
    if (isFixedApp()) {
      return envSiteName ?? props.siteName ?? selectedApp() ?? "Rocket";
    }
    const entity = currentEntity();
    if (entity) {
      const uiConfig = getEntityUIConfig(entity);
      if (uiConfig?.pages?.landing?.title) {
        return uiConfig.pages.landing.title;
      }
    }
    return props.siteName ?? selectedApp() ?? "Rocket";
  });

  return (
    <div class="public-layout">
      <header class="public-header">
        <div class="public-header-inner">
          <A href={publicNavLinks().length > 0 ? publicNavLinks()[0].route : "/dashboard"} class="public-logo">
            {siteName()}
          </A>
          <nav class="public-nav">
            <For each={publicNavLinks()}>
              {(link) => (
                <A href={link.route} class="public-nav-link">
                  {link.label}
                </A>
              )}
            </For>
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
