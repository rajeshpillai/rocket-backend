import { createSignal, createEffect, Show, For } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { listRecords } from "../../api/data";
import { getEntityUIConfig } from "../../stores/ui-config";
import { addToast } from "../../stores/notifications";
import { isApiError } from "../../types/api";
import type { LandingPageConfig, CardConfig } from "../../types/ui-config";
import PostCard from "../../components/post-card";
import Pagination from "../../components/pagination";

export default function PostLandingPage() {
  const navigate = useNavigate();

  const [records, setRecords] = createSignal<Record<string, unknown>[]>([]);
  const [total, setTotal] = createSignal(0);
  const [page, setPage] = createSignal(1);
  const [loading, setLoading] = createSignal(true);
  const [config, setConfig] = createSignal<LandingPageConfig | null>(null);

  createEffect(() => {
    const uiConfig = getEntityUIConfig("post");
    if (uiConfig?.pages?.landing) {
      setConfig(uiConfig.pages.landing);
      fetchData(uiConfig.pages.landing);
    } else {
      // Default config if none provided
      setConfig({
        route: "/pages/post",
        title: "Articles",
        layout: "card-grid",
        data: {
          include: "author,tags",
          sort: "-created_at",
          per_page: 12,
        },
        card: {
          title: "title",
          excerpt: "excerpt",
          date: "created_at",
        },
      });
      fetchData(null);
    }
  });

  async function fetchData(cfg: LandingPageConfig | null) {
    setLoading(true);
    try {
      const dataConfig = cfg?.data ?? {};
      const filterMap: Record<string, string> = {};

      // Apply filters from config
      if (dataConfig.filter) {
        for (const [key, value] of Object.entries(dataConfig.filter)) {
          filterMap[`filter[${key}]`] = value;
        }
      }

      const res = await listRecords("post", {
        page: page(),
        per_page: dataConfig.per_page ?? 12,
        sort: dataConfig.sort ?? "-created_at",
        include: dataConfig.include,
        filters: filterMap,
      });

      setRecords(res.data);
      setTotal(res.meta?.total ?? res.data.length);
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
      } else {
        addToast("error", "Failed to fetch posts");
      }
    } finally {
      setLoading(false);
    }
  }

  function handlePageChange(p: number) {
    setPage(p);
    fetchData(config());
  }

  function handleCardClick(record: Record<string, unknown>) {
    const id = record.id ?? record.slug;
    if (id) {
      navigate(`/pages/post/${id}`);
    }
  }

  const cardConfig = (): CardConfig => {
    return (
      config()?.card ?? {
        title: "title",
        excerpt: "excerpt",
        date: "created_at",
      }
    );
  };

  const perPage = () => config()?.data?.per_page ?? 12;

  return (
    <div>
      <div class="public-page-header">
        <h1 class="public-page-title">{config()?.title ?? "Articles"}</h1>
        <Show when={config()?.subtitle}>
          <p class="public-page-subtitle">{config()!.subtitle}</p>
        </Show>
      </div>

      <Show when={loading()}>
        <div class="public-loading">
          <div class="public-spinner" />
        </div>
      </Show>

      <Show when={!loading()}>
        <Show
          when={records().length > 0}
          fallback={
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
                  d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
                />
              </svg>
              <p class="public-empty-text">No articles found</p>
            </div>
          }
        >
          <div class="post-card-grid">
            <For each={records()}>
              {(record) => (
                <PostCard
                  record={record}
                  config={cardConfig()}
                  onClick={() => handleCardClick(record)}
                />
              )}
            </For>
          </div>

          <Show when={total() > perPage()}>
            <div class="mt-8">
              <Pagination
                page={page()}
                perPage={perPage()}
                total={total()}
                onPageChange={handlePageChange}
                hidePerPage
              />
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
