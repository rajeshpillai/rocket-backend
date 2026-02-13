import type { Component } from "solid-js";

type PageType = "list" | "detail";

// Register custom page components for specific entities.
// When a custom page exists, it replaces the generic entity-list or entity-detail page.
//
// Example usage:
//   import { lazy } from "solid-js";
//   customPages["post"] = {
//     list: lazy(() => import("./post-list")),
//   };
//
// The custom component receives no props — it should use useParams() to get the entity name and ID.

const customPages: Record<string, Partial<Record<PageType, Component<any>>>> = {
  // Add custom pages here, e.g.:
  // "post": {
  //   list: lazy(() => import("./post-list")),
  //   detail: lazy(() => import("./post-detail")),
  // },
};

export function getCustomPage(
  entity: string,
  type: PageType
): Component<any> | null {
  return customPages[entity]?.[type] ?? null;
}

export function registerCustomPage(
  entity: string,
  type: PageType,
  component: Component<any>
): void {
  if (!customPages[entity]) {
    customPages[entity] = {};
  }
  customPages[entity][type] = component;
}
