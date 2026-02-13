import { createSignal, Show, For } from "solid-js";
import type { CommentSection as CommentSectionConfig } from "../types/ui-config";
import { createRecord } from "../api/data";
import { addToast } from "../stores/notifications";
import { isApiError } from "../types/api";

interface CommentSectionProps {
  config: CommentSectionConfig;
  comments: Record<string, unknown>[];
  postId: string;
  postEntity: string;
}

function formatDate(dateStr: unknown): string {
  if (!dateStr || typeof dateStr !== "string") return "";
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(dateStr);
  }
}

export default function CommentSectionComponent(props: CommentSectionProps) {
  const [formData, setFormData] = createSignal<Record<string, string>>({});
  const [errors, setErrors] = createSignal<Record<string, string>>({});
  const [submitting, setSubmitting] = createSignal(false);
  const [pendingComment, setPendingComment] = createSignal<Record<string, string> | null>(null);

  const displayFields = () => props.config.display_fields ?? {
    author: "author_name",
    date: "created_at",
    body: "body",
  };

  const submitFields = () => props.config.submit_fields ?? {};

  function validateForm(): boolean {
    const errs: Record<string, string> = {};
    const fields = submitFields();
    const data = formData();

    for (const [fieldName, fieldConfig] of Object.entries(fields)) {
      if (fieldConfig.required && !data[fieldName]?.trim()) {
        errs[fieldName] = `${fieldConfig.label} is required`;
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();

    if (!validateForm()) return;

    setSubmitting(true);
    setErrors({});

    try {
      const data = formData();
      const commentEntity = props.config.relation;

      // Build the payload with the post reference
      const payload: Record<string, unknown> = {
        ...data,
        [`${props.postEntity}_id`]: props.postId,
        status: "pending", // Comments start as pending for moderation
      };

      await createRecord(commentEntity, payload);

      // Store the pending comment to show feedback
      setPendingComment({ ...data });

      // Clear the form
      setFormData({});

      addToast("success", "Comment submitted for moderation");
    } catch (err) {
      if (isApiError(err)) {
        addToast("error", err.error.message);
        if (err.error.details) {
          const errs: Record<string, string> = {};
          for (const d of err.error.details) {
            if (d.field) errs[d.field] = d.message;
          }
          setErrors(errs);
        }
      } else {
        addToast("error", "Failed to submit comment");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function updateField(field: string, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <section class="comments-section">
      <h2 class="comments-title">
        {props.config.title ?? "Comments"} ({props.comments.length})
      </h2>

      {/* Pending comment notification */}
      <Show when={pendingComment()}>
        <div class="comment-pending">
          {props.config.pending_message ?? "Your comment is awaiting moderation."}
        </div>
      </Show>

      {/* Comments list */}
      <div class="comments-list">
        <Show
          when={props.comments.length > 0}
          fallback={
            <p class="text-gray-500 text-center py-4">
              No comments yet. Be the first to comment!
            </p>
          }
        >
          <For each={props.comments}>
            {(comment) => (
              <div class="comment-item">
                <div class="comment-header">
                  <span class="comment-author">
                    {String(comment[displayFields().author ?? "author_name"] ?? "Anonymous")}
                  </span>
                  <span class="comment-date">
                    {formatDate(comment[displayFields().date ?? "created_at"])}
                  </span>
                </div>
                <p class="comment-body">
                  {String(comment[displayFields().body ?? "body"] ?? "")}
                </p>
              </div>
            )}
          </For>
        </Show>
      </div>

      {/* Comment form */}
      <Show when={props.config.allow_submit}>
        <form class="comment-form" onSubmit={handleSubmit}>
          <h3 class="comment-form-title">Leave a Comment</h3>

          <div class="comment-form-grid">
            <For each={Object.entries(submitFields())}>
              {([fieldName, fieldConfig]) => (
                <div
                  class={`comment-form-field ${
                    fieldConfig.widget === "textarea" ? "comment-form-field-full" : ""
                  }`}
                >
                  <label class="comment-form-label">
                    {fieldConfig.label}
                    {fieldConfig.required && <span class="text-red-500 ml-1">*</span>}
                  </label>

                  <Show
                    when={fieldConfig.widget === "textarea"}
                    fallback={
                      <input
                        type={fieldName.includes("email") ? "email" : "text"}
                        class="comment-form-input"
                        value={formData()[fieldName] ?? ""}
                        onInput={(e) => updateField(fieldName, e.currentTarget.value)}
                        disabled={submitting()}
                      />
                    }
                  >
                    <textarea
                      class="comment-form-textarea"
                      rows={fieldConfig.rows ?? 4}
                      value={formData()[fieldName] ?? ""}
                      onInput={(e) => updateField(fieldName, e.currentTarget.value)}
                      disabled={submitting()}
                    />
                  </Show>

                  <Show when={errors()[fieldName]}>
                    <p class="comment-form-error">{errors()[fieldName]}</p>
                  </Show>
                </div>
              )}
            </For>
          </div>

          <button
            type="submit"
            class="comment-form-submit"
            disabled={submitting()}
          >
            {submitting() ? "Submitting..." : "Post Comment"}
          </button>
        </form>
      </Show>
    </section>
  );
}
