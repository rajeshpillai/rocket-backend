import { createSignal, createEffect, Show, For } from "solid-js";
import { useParams, A } from "@solidjs/router";
import { getRecord } from "../../api/data";
import { getEntityUIConfig } from "../../stores/ui-config";
import { selectedApp } from "../../stores/app";
import { addToast } from "../../stores/notifications";
import { isApiError } from "../../types/api";
import type { DetailPageConfig, CommentSection as CommentSectionType } from "../../types/ui-config";
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

export default function EntityDetailPage() {
  const params = useParams();

  const [record, setRecord] = createSignal<Record<string, unknown> | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [config, setConfig] = createSignal<DetailPageConfig | null>(null);

  const entityName = () => params.entity;

  createEffect(() => {
    const entity = entityName();
    const id = params.id;
    if (entity && id) {
      loadRecord(entity, id);
    }
  });

  async function loadRecord(entity: string, id: string) {
    setLoading(true);

    const uiConfig = getEntityUIConfig(entity);
    const detailConfig = uiConfig?.pages?.detail;
    setConfig(detailConfig ?? null);

    try {
      const include = detailConfig?.data?.include ?? "";
      const data = await getRecord(entity, id, include || undefined);
      setRecord(data);
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", `Failed to load ${entity} record`);
      }
    } finally {
      setLoading(false);
    }
  }

  const heroImage = () => {
    const rec = record();
    if (!rec) return null;
    const heroSection = config()?.sections?.find((s) => s.type === "hero") as { image?: string } | undefined;
    if (!heroSection) return null;
    const imageField = heroSection.image ?? "featured_image";
    return getFileUrl(rec[imageField]);
  };

  const hasHeroSection = () => {
    return config()?.sections?.some((s) => s.type === "hero") ?? false;
  };

  const title = () => {
    const rec = record();
    if (!rec) return "";
    // Try hero section title config first
    const heroSection = config()?.sections?.find((s) => s.type === "hero") as { title?: string } | undefined;
    const titleField = heroSection?.title ?? "title";
    return String(rec[titleField] ?? rec["name"] ?? "");
  };

  const author = () => {
    const rec = record();
    if (!rec) return null;
    const metaSection = config()?.sections?.find((s) => s.type === "meta") as {
      author?: { relation: string; name_field: string; avatar_field?: string };
    } | undefined;
    if (!metaSection?.author) return null;
    const authorConfig = metaSection.author;
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
    const dateField = metaSection?.date ?? "created_at";
    return formatDate(rec[dateField]);
  };

  const tags = () => {
    const rec = record();
    if (!rec) return [];
    const metaSection = config()?.sections?.find((s) => s.type === "meta") as {
      tags?: { relation: string; name_field: string };
    } | undefined;
    if (!metaSection?.tags) return [];
    const tagsConfig = metaSection.tags;
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

  const contentFormat = () => {
    const contentSection = config()?.sections?.find((s) => s.type === "content") as { format?: string } | undefined;
    return contentSection?.format ?? "text";
  };

  const comments = () => {
    const rec = record();
    if (!rec) return [];
    const commentSection = config()?.sections?.find((s) => s.type === "comments") as CommentSectionType | undefined;
    if (!commentSection) return [];
    const commentRelation = commentSection.relation ?? "comments";
    const commentsData = rec[commentRelation] as Record<string, unknown>[] | undefined;
    if (!commentsData || !Array.isArray(commentsData)) return [];

    // Apply filters from config
    const filter = commentSection.filter;
    if (filter) {
      return commentsData.filter((c) => {
        for (const [key, value] of Object.entries(filter)) {
          if (c[key] !== value) return false;
        }
        return true;
      });
    }
    return commentsData;
  };

  const commentSectionConfig = (): CommentSectionType | null => {
    return (config()?.sections?.find((s) => s.type === "comments") as CommentSectionType) ?? null;
  };

  const landingTitle = () => {
    const entity = entityName();
    if (!entity) return "Back";
    const uiConfig = getEntityUIConfig(entity);
    return uiConfig?.pages?.landing?.title ?? entity.charAt(0).toUpperCase() + entity.slice(1) + "s";
  };

  function renderContent(text: string) {
    if (contentFormat() === "text") {
      const paragraphs = text.split(/\n\n+/);
      return paragraphs.map((p) => {
        const trimmed = p.trim();
        if (!trimmed) return null;
        return <p>{trimmed}</p>;
      });
    }

    // Markdown-like rendering
    const paragraphs = text.split(/\n\n+/);
    return paragraphs.map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return null;

      if (trimmed.startsWith("## ")) {
        return <h2>{trimmed.slice(3)}</h2>;
      }
      if (trimmed.startsWith("### ")) {
        return <h3>{trimmed.slice(4)}</h3>;
      }

      return <p>{trimmed}</p>;
    });
  }

  return (
    <div>
      <A href={`/pages/${entityName()}`} class="back-link">
        <svg class="back-link-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
        Back to {landingTitle()}
      </A>

      <Show when={loading()}>
        <div class="public-loading">
          <div class="public-spinner" />
        </div>
      </Show>

      <Show when={!loading() && record()}>
        <article class="article-container">
          {/* Hero section - only if configured */}
          <Show when={hasHeroSection()}>
            <div class="article-hero">
              <Show
                when={heroImage()}
                fallback={<div class="article-hero-no-image" />}
              >
                <img src={heroImage()!} alt={title()} class="article-hero-image" />
              </Show>
            </div>
          </Show>

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

            <Show when={!author() && date()}>
              <span class="article-date">{date()}</span>
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

          {/* Comments / Conversation section */}
          <Show when={commentSectionConfig()}>
            <CommentSectionComponent
              config={commentSectionConfig()!}
              comments={comments()}
              postId={String(record()!.id)}
              postEntity={entityName() ?? ""}
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
          <p class="public-empty-text">Record not found</p>
        </div>
      </Show>
    </div>
  );
}
