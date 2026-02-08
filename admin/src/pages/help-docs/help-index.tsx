import { For } from "solid-js";
import { A } from "@solidjs/router";
import { helpTopics, categoryOrder } from "./help-types";

export function HelpIndex() {
  const grouped = () => {
    const map: Record<string, typeof helpTopics> = {};
    for (const t of helpTopics) {
      (map[t.category] ??= []).push(t);
    }
    return map;
  };

  return (
    <div>
      <div class="page-header">
        <div>
          <h1 class="page-title">Help & Documentation</h1>
          <p class="page-subtitle">
            Learn how to build databases, define rules, create workflows, and more with Rocket
          </p>
        </div>
      </div>

      <For each={categoryOrder}>
        {(category) => (
          <div class="help-category-group">
            <h2 class="help-category-title">{category}</h2>
            <div class="help-card-grid">
              <For each={grouped()[category] ?? []}>
                {(topic) => (
                  <A href={`/help/${topic.slug}`} class="help-card">
                    <div class="help-card-icon">{topic.icon}</div>
                    <div>
                      <div class="help-card-title">{topic.title}</div>
                      <div class="help-card-subtitle">{topic.subtitle}</div>
                    </div>
                  </A>
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
