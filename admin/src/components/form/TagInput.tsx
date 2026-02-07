import { createSignal, For, Show } from "solid-js";

interface TagInputProps {
  label?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export function TagInput(props: TagInputProps) {
  const [input, setInput] = createSignal("");

  const addTag = () => {
    const val = input().trim();
    if (val && !props.tags.includes(val)) {
      props.onChange([...props.tags, val]);
      setInput("");
    }
  };

  const removeTag = (tag: string) => {
    props.onChange(props.tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
    if (e.key === "Backspace" && input() === "" && props.tags.length > 0) {
      removeTag(props.tags[props.tags.length - 1]);
    }
  };

  return (
    <div class="form-group">
      <Show when={props.label}>
        <label class="form-label">{props.label}</label>
      </Show>
      <div class="tag-list">
        <For each={props.tags}>
          {(tag) => (
            <span class="tag">
              {tag}
              <button class="tag-remove" onClick={() => removeTag(tag)}>
                ×
              </button>
            </span>
          )}
        </For>
      </div>
      <input
        type="text"
        class="form-input"
        value={input()}
        onInput={(e) => setInput(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder={props.placeholder ?? "Type and press Enter"}
      />
    </div>
  );
}
