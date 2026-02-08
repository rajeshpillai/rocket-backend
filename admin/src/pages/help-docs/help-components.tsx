import { type JSX, createSignal } from "solid-js";

/* ── CodeBlock ── */

interface CodeBlockProps {
  language?: string;
  title?: string;
  children: string;
}

export function CodeBlock(props: CodeBlockProps) {
  const [copied, setCopied] = createSignal(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(props.children);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div class="help-code-block">
      <div class="help-code-header">
        <span class="help-code-lang">{props.language ?? "text"}</span>
        {props.title && <span class="help-code-title">{props.title}</span>}
        <button class="help-code-copy" onClick={handleCopy}>
          {copied() ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre class="help-code-pre"><code>{props.children}</code></pre>
    </div>
  );
}

/* ── InfoBox ── */

interface InfoBoxProps {
  type: "tip" | "warning" | "note" | "important";
  title?: string;
  children: JSX.Element;
}

export function InfoBox(props: InfoBoxProps) {
  const labels: Record<string, string> = { tip: "Tip", warning: "Warning", note: "Note", important: "Important" };
  return (
    <div class={`help-info-box help-info-box-${props.type}`}>
      <div class="help-info-box-title">{props.title ?? labels[props.type]}</div>
      <div>{props.children}</div>
    </div>
  );
}

/* ── PropsTable ── */

interface PropsTableProps {
  columns: string[];
  rows: (string | JSX.Element)[][];
}

export function PropsTable(props: PropsTableProps) {
  return (
    <div class="help-table-wrap">
      <table class="help-table">
        <thead>
          <tr>
            {props.columns.map((col) => (
              <th class="help-table-th">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr>
              {row.map((cell) => (
                <td class="help-table-td">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Section ── */

interface SectionProps {
  title: string;
  id?: string;
  children: JSX.Element;
}

export function Section(props: SectionProps) {
  return (
    <div class="section" id={props.id}>
      <h2 class="section-title">{props.title}</h2>
      {props.children}
    </div>
  );
}

/* ── EndpointBlock ── */

interface EndpointBlockProps {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  description?: string;
}

export function EndpointBlock(props: EndpointBlockProps) {
  const colors: Record<string, string> = {
    GET: "help-method-get",
    POST: "help-method-post",
    PUT: "help-method-put",
    DELETE: "help-method-delete",
  };
  return (
    <div class="help-endpoint">
      <span class={`help-method ${colors[props.method]}`}>{props.method}</span>
      <code class="help-endpoint-url">{props.url}</code>
      {props.description && <span class="help-endpoint-desc">— {props.description}</span>}
    </div>
  );
}

/* ── InlineCode ── */

export function C(props: { children: string }) {
  return <code class="help-inline-code">{props.children}</code>;
}
