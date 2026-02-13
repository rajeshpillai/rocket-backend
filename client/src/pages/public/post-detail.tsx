import { createSignal, createEffect, Show, For } from "solid-js";
import { useParams, A } from "@solidjs/router";
import { getRecord } from "../../api/data";
import { getEntityUIConfig } from "../../stores/ui-config";
import { selectedApp } from "../../stores/app";
import { addToast } from "../../stores/notifications";
import { isApiError } from "../../types/api";
import type { DetailPageConfig, PageSection, CommentSection as CommentSectionType } from "../../types/ui-config";
import CommentSectionComponent from "../../components/comment-section";

function formatDate(dateStr: unknown): string {
  if (!dateStr || typeof dateStr !== "string") return "";
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return String(dateStr);
  }
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getFileUrl(fileData: unknown): string | null {
  if (!fileData || typeof fileData !== "object") return null;
  const file = fileData as Record<string, unknown>;
  if (file.id && selectedApp()) {
    return `/api/${selectedApp()}/_files/${file.id}`;
  }
  return null;
}

export default function PostDetailPage() {
  const params = useParams();

  const [record, setRecord] = createSignal<Record<string, unknown> | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [config, setConfig] = createSignal<DetailPageConfig | null>(null);

  createEffect(() => {
    const postId = params.id;
    if (postId) {
      loadPost(postId);
    }
  });

  async function loadPost(id: string) {
    setLoading(true);

    // Get config
    const uiConfig = getEntityUIConfig("post");
    const detailConfig = uiConfig?.pages?.detail;
    setConfig(detailConfig ?? null);

    try {
      const include = detailConfig?.data?.include ?? "author,tags,comments";
      const data = await getRecord("post", id, include);
      setRecord(data);
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to load post");
      }
    } finally {
      setLoading(false);
    }
  }

  // Extract data from record based on config
  const heroImage = () => {
    const rec = record();
    if (!rec) return null;
    const heroSection = config()?.sections?.find((s) => s.type === "hero") as { image?: string } | undefined;
    const imageField = heroSection?.image ?? "featured_image";
    return getFileUrl(rec[imageField]);
  };

  const title = () => {
    const rec = record();
    if (!rec) return "";
    const heroSection = config()?.sections?.find((s) => s.type === "hero") as { title?: string } | undefined;
    const titleField = heroSection?.title ?? "title";
    return String(rec[titleField] ?? "");
  };

  const author = () => {
    const rec = record();
    if (!rec) return null;
    const metaSection = config()?.sections?.find((s) => s.type === "meta") as {
      author?: { relation: string; name_field: string; avatar_field?: string };
    } | undefined;
    const authorConfig = metaSection?.author ?? { relation: "author", name_field: "name", avatar_field: "avatar" };
    const authorData = rec[authorConfig.relation] as Record<string, unknown> | undefined;
    if (!authorData) return null;
    return {
      name: String(authorData[authorConfig.name_field] ?? ""),
      avatar: authorConfig.avatar_field ? getFileUrl(authorData[authorConfig.avatar_field]) : null,
    };
  };

  const date = () => {
    const rec = record();
    if (!rec) return null;
    const metaSection = config()?.sections?.find((s) => s.type === "meta") as { date?: string } | undefined;
    const dateField = metaSection?.date ?? "published_at";
    return formatDate(rec[dateField]);
  };

  const tags = () => {
    const rec = record();
    if (!rec) return [];
    const metaSection = config()?.sections?.find((s) => s.type === "meta") as {
      tags?: { relation: string; name_field: string };
    } | undefined;
    const tagsConfig = metaSection?.tags ?? { relation: "tags", name_field: "name" };
    const tagsData = rec[tagsConfig.relation] as Record<string, unknown>[] | undefined;
    if (!tagsData || !Array.isArray(tagsData)) return [];
    return tagsData.map((t) => String(t[tagsConfig.name_field] ?? ""));
  };

  const body = () => {
    const rec = record();
    if (!rec) return "";
    const contentSection = config()?.sections?.find((s) => s.type === "content") as { field?: string } | undefined;
    const bodyField = contentSection?.field ?? "body";
    return String(rec[bodyField] ?? "");
  };

  const comments = () => {
    const rec = record();
    if (!rec) return [];
    const commentSection = config()?.sections?.find((s) => s.type === "comments") as CommentSectionType | undefined;
    const commentRelation = commentSection?.relation ?? "comments";
    const commentsData = rec[commentRelation] as Record<string, unknown>[] | undefined;
    if (!commentsData || !Array.isArray(commentsData)) return [];

    // Filter by status if specified
    const filter = commentSection?.filter;
    if (filter?.status) {
      return commentsData.filter((c) => c.status === filter.status);
    }
    return commentsData;
  };

  const commentSectionConfig = (): CommentSectionType | null => {
    return (config()?.sections?.find((s) => s.type === "comments") as CommentSectionType) ?? null;
  };

  // Simple markdown-like rendering (basic formatting)
  function renderContent(text: string) {
    // Split into paragraphs
    const paragraphs = text.split(/\n\n+/);
    return paragraphs.map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return null;

      // Check for headers
      if (trimmed.startsWith("## ")) {
        return <h2>{trimmed.slice(3)}</h2>;
      }
      if (trimmed.startsWith("### ")) {
        return <h3>{trimmed.slice(4)}</h3>;
      }

      // Regular paragraph
      return <p>{trimmed}</p>;
    });
  }

  return (
    <div>
      <A href="/pages/post" class="back-link">
        <svg class="back-link-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Articles
      </A>

      <Show when={loading()}>
        <div class="public-loading">
          <div class="public-spinner" />
        </div>
      </Show>

      <Show when={!loading() && record()}>
        <article class="article-container">
          {/* Hero section */}
          <div class="article-hero">
            <Show
              when={heroImage()}
              fallback={<div class="article-hero-no-image" />}
            >
              <img src={heroImage()!} alt={title()} class="article-hero-image" />
            </Show>
          </div>

          <h1 class="article-title">{title()}</h1>

          {/* Meta section */}
          <div class="article-meta">
            <Show when={author()}>
              <div class="article-author">
                <Show
                  when={author()!.avatar}
                  fallback={
                    <div class="article-avatar-placeholder">
                      {getInitials(author()!.name)}
                    </div>
                  }
                >
                  <img src={author()!.avatar!} alt={author()!.name} class="article-avatar" />
                </Show>
                <div class="article-author-info">
                  <span class="article-author-name">{author()!.name}</span>
                  <Show when={date()}>
                    <span class="article-date">{date()}</span>
                  </Show>
                </div>
              </div>
            </Show>

            <Show when={tags().length > 0}>
              <div class="article-tags">
                <For each={tags()}>
                  {(tag) => <span class="tag-pill">{tag}</span>}
                </For>
              </div>
            </Show>
          </div>

          {/* Content section */}
          <div class="article-content">
            {renderContent(body())}
          </div>

          {/* Comments section */}
          <Show when={commentSectionConfig()}>
            <CommentSectionComponent
              config={commentSectionConfig()!}
              comments={comments()}
              postId={String(record()!.id)}
              postEntity="post"
            />
          </Show>
        </article>
      </Show>

      <Show when={!loading() && !record()}>
        <div class="public-empty">
          <svg
            class="public-empty-icon"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p class="public-empty-text">Post not found</p>
        </div>
      </Show>
    </div>
  );
}
