import { Show, For } from "solid-js";
import type { CardConfig } from "../types/ui-config";
import { selectedApp } from "../stores/app";

interface PostCardProps {
  record: Record<string, unknown>;
  config: CardConfig;
  onClick?: () => void;
}

function formatDate(dateStr: unknown): string {
  if (!dateStr || typeof dateStr !== "string") return "";
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
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

export default function PostCard(props: PostCardProps) {
  const imageUrl = () => {
    if (!props.config.image) return null;
    return getFileUrl(props.record[props.config.image]);
  };

  const title = () => String(props.record[props.config.title] ?? "Untitled");

  const excerpt = () => {
    if (!props.config.excerpt) return null;
    const val = props.record[props.config.excerpt];
    return val ? String(val) : null;
  };

  const date = () => {
    if (!props.config.date) return null;
    return formatDate(props.record[props.config.date]);
  };

  const author = () => {
    if (!props.config.author) return null;
    const rel = props.config.author;
    const authorData = props.record[rel.relation] as Record<string, unknown> | undefined;
    if (!authorData) return null;
    return {
      name: String(authorData[rel.name_field] ?? ""),
      avatar: rel.avatar_field ? getFileUrl(authorData[rel.avatar_field]) : null,
    };
  };

  const tags = () => {
    if (!props.config.tags) return [];
    const rel = props.config.tags;
    const tagsData = props.record[rel.relation] as Record<string, unknown>[] | undefined;
    if (!tagsData || !Array.isArray(tagsData)) return [];
    const max = rel.max ?? tagsData.length;
    return tagsData.slice(0, max).map((t) => String(t[rel.name_field] ?? ""));
  };

  return (
    <article class="post-card" onClick={props.onClick}>
      <Show
        when={imageUrl()}
        fallback={
          <div class="post-card-image-placeholder">
            <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        }
      >
        <img src={imageUrl()!} alt={title()} class="post-card-image" loading="lazy" />
      </Show>

      <div class="post-card-body">
        <Show when={tags().length > 0}>
          <div class="post-card-tags">
            <For each={tags()}>
              {(tag) => <span class="tag-pill tag-pill-sm">{tag}</span>}
            </For>
          </div>
        </Show>

        <h3 class="post-card-title">{title()}</h3>

        <Show when={excerpt()}>
          <p class="post-card-excerpt">{excerpt()}</p>
        </Show>

        <div class="post-card-meta">
          <Show when={author()}>
            <div class="post-card-author">
              <Show
                when={author()!.avatar}
                fallback={
                  <div class="post-card-avatar-placeholder">
                    {getInitials(author()!.name)}
                  </div>
                }
              >
                <img src={author()!.avatar!} alt={author()!.name} class="post-card-avatar" />
              </Show>
              <span class="post-card-author-name">{author()!.name}</span>
            </div>
          </Show>

          <Show when={date()}>
            <span class="post-card-date">{date()}</span>
          </Show>
        </div>
      </div>
    </article>
  );
}
