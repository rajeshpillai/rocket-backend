import { Show, For, type JSX, lazy } from "solid-js";
import { A, useParams } from "@solidjs/router";
import { helpTopics } from "./help-types";

const topicComponents: Record<string, () => JSX.Element> = {
  "getting-started": lazy(() => import("./getting-started")),
  "entities": lazy(() => import("./entities")),
  "relations": lazy(() => import("./relations")),
  "crud-and-querying": lazy(() => import("./crud-and-querying")),
  "nested-writes": lazy(() => import("./nested-writes")),
  "validation-rules": lazy(() => import("./validation-rules")),
  "state-machines": lazy(() => import("./state-machines")),
  "workflows": lazy(() => import("./workflows")),
  "webhooks": lazy(() => import("./webhooks")),
  "permissions": lazy(() => import("./permissions")),
  "file-uploads": lazy(() => import("./file-uploads")),
  "schema-export-import": lazy(() => import("./schema-export-import")),
  "api-reference": lazy(() => import("./api-reference")),
};

export function HelpTopicPage() {
  const params = useParams();

  const topic = () => helpTopics.find((t) => t.slug === params.topic);
  const topicIndex = () => helpTopics.findIndex((t) => t.slug === params.topic);
  const prevTopic = () => (topicIndex() > 0 ? helpTopics[topicIndex() - 1] : null);
  const nextTopic = () =>
    topicIndex() < helpTopics.length - 1 ? helpTopics[topicIndex() + 1] : null;

  const TopicContent = () => {
    const Comp = topicComponents[params.topic];
    return Comp ? <Comp /> : null;
  };

  return (
    <div>
      <div class="help-breadcrumb">
        <A href="/help">Help</A>
        <span>/</span>
        <span>{topic()?.title ?? "Not Found"}</span>
      </div>

      <Show
        when={topic()}
        fallback={
          <div class="section">
            <p>Topic not found. <A href="/help">Back to Help</A></p>
          </div>
        }
      >
        <div class="help-topic-layout">
          <aside class="help-topic-nav">
            <For each={helpTopics}>
              {(t) => (
                <A
                  href={`/help/${t.slug}`}
                  class={`help-topic-nav-link ${t.slug === params.topic ? "active" : ""}`}
                >
                  {t.title}
                </A>
              )}
            </For>
          </aside>

          <div class="help-topic-content">
            <h1 class="page-title">{topic()!.title}</h1>
            <p class="page-subtitle">{topic()!.subtitle}</p>

            <div style={{ "margin-top": "1.5rem" }}>
              <TopicContent />
            </div>

            <div class="help-prev-next">
              <div>
                <Show when={prevTopic()}>
                  <A href={`/help/${prevTopic()!.slug}`} class="help-prev-next-link">
                    &larr; {prevTopic()!.title}
                  </A>
                </Show>
              </div>
              <div>
                <Show when={nextTopic()}>
                  <A href={`/help/${nextTopic()!.slug}`} class="help-prev-next-link">
                    {nextTopic()!.title} &rarr;
                  </A>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
