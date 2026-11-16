import type { ReactNode } from "react";

function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^mailto:/i.test(trimmed)) return trimmed;
  return null;
}

function inlines(input: string, onOpenWiki?: (title: string) => void): ReactNode[] {
  const nodes: ReactNode[] = [];
  let key = 0;
  let buffer = "";
  let index = 0;

  const flush = () => {
    if (!buffer) return;
    nodes.push(buffer);
    buffer = "";
  };

  while (index < input.length) {
    if (input[index] === "`") {
      const end = input.indexOf("`", index + 1);
      if (end > index + 1) {
        flush();
        nodes.push(<code key={key++}>{input.slice(index + 1, end)}</code>);
        index = end + 1;
        continue;
      }
    }

    if (input.startsWith("![", index)) {
      const close = input.indexOf("]", index + 2);
      if (close > index && input[close + 1] === "(") {
        const end = input.indexOf(")", close + 2);
        if (end > close) {
          const alt = input.slice(index + 2, close).trim();
          flush();
          nodes.push(
            <span key={key++} className="quire-image">
              {alt || "Image"}
            </span>,
          );
          index = end + 1;
          continue;
        }
      }
    }

    if (input.startsWith("[[", index)) {
      const end = input.indexOf("]]", index + 2);
      const title = end > index + 2 ? input.slice(index + 2, end).trim() : "";
      if (title && title.length <= 120 && !title.includes("[")) {
        flush();
        nodes.push(
          onOpenWiki ? (
            <button key={key++} type="button" className="quire-wiki" onClick={() => onOpenWiki(title)}>
              {title}
            </button>
          ) : (
            <span key={key++} className="quire-wiki">
              {title}
            </span>
          ),
        );
        index = end + 2;
        continue;
      }
    }

    if (input[index] === "[") {
      const close = input.indexOf("]", index + 1);
      if (close > index + 1 && input[close + 1] === "(") {
        const end = input.indexOf(")", close + 2);
        if (end > close) {
          const href = safeUrl(input.slice(close + 2, end));
          if (href) {
            flush();
            nodes.push(
              <a key={key++} href={href} target="_blank" rel="noreferrer noopener">
                {inlines(input.slice(index + 1, close), onOpenWiki)}
              </a>,
            );
            index = end + 1;
            continue;
          }
        }
      }
    }

    if (input.startsWith("***", index)) {
      const end = input.indexOf("***", index + 3);
      if (end > index + 3) {
        flush();
        nodes.push(
          <strong key={key++}>
            <em>{inlines(input.slice(index + 3, end), onOpenWiki)}</em>
          </strong>,
        );
        index = end + 3;
        continue;
      }
    }

    if (input.startsWith("**", index) || input.startsWith("__", index)) {
      const marker = input.slice(index, index + 2);
      const end = input.indexOf(marker, index + 2);
      if (end > index + 2) {
        flush();
        nodes.push(<strong key={key++}>{inlines(input.slice(index + 2, end), onOpenWiki)}</strong>);
        index = end + 2;
        continue;
      }
    }

    if (input.startsWith("~~", index)) {
      const end = input.indexOf("~~", index + 2);
      if (end > index + 2) {
        flush();
        nodes.push(<s key={key++}>{inlines(input.slice(index + 2, end), onOpenWiki)}</s>);
        index = end + 2;
        continue;
      }
    }

    const marker = input[index];
    if ((marker === "*" || marker === "_") && input[index + 1] && input[index + 1] !== " " && input[index + 1] !== marker) {
      const end = input.indexOf(marker, index + 1);
      if (end > index + 1 && input[end - 1] !== " ") {
        flush();
        nodes.push(<em key={key++}>{inlines(input.slice(index + 1, end), onOpenWiki)}</em>);
        index = end + 1;
        continue;
      }
    }

    buffer += input[index];
    index += 1;
  }

  flush();
  return nodes;
}

function isListLine(line: string): boolean {
  return /^\s*(?:[-*+]|\d+\.)\s+/.test(line);
}

function isOrdered(line: string): boolean {
  return /^\s*\d+\.\s+/.test(line);
}

function isBlockStart(line: string): boolean {
  return (
    line.startsWith("```") ||
    /^(#{1,6})\s+/.test(line) ||
    /^>\s?/.test(line) ||
    isListLine(line) ||
    /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())
  );
}

function renderMarkdown(source: string, onOpenWiki?: (title: string) => void): ReactNode[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;
  const nextKey = () => `b${key++}`;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const buffer: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        buffer.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={nextKey()}>
          <code>{buffer.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push(<hr key={nextKey()} />);
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      blocks.push(<Tag key={nextKey()}>{inlines(heading[2] ?? "", onOpenWiki)}</Tag>);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buffer: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        buffer.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={nextKey()}>{inlines(buffer.join(" "), onOpenWiki)}</blockquote>);
      continue;
    }

    if (isListLine(line)) {
      const ordered = isOrdered(line);
      const items: ReactNode[] = [];
      let tasksOnly = true;
      while (
        index < lines.length &&
        isListLine(lines[index] ?? "") &&
        isOrdered(lines[index] ?? "") === ordered
      ) {
        const raw = (lines[index] ?? "").replace(/^\s*(?:[-*+]|\d+\.)\s+/, "");
        const task = /^\[([ xX])\]\s*(.*)$/.exec(raw);
        if (task) {
          const checked = (task[1] ?? "").toLowerCase() === "x";
          items.push(
            <li key={items.length} className="task-item">
              <input
                type="checkbox"
                checked={checked}
                readOnly
                tabIndex={-1}
                aria-label={checked ? "Done" : "Not done"}
              />
              <span>{inlines(task[2] ?? "", onOpenWiki)}</span>
            </li>,
          );
        } else {
          tasksOnly = false;
          items.push(<li key={items.length}>{inlines(raw, onOpenWiki)}</li>);
        }
        index += 1;
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={nextKey()} className={tasksOnly ? "task" : undefined}>
          {items}
        </Tag>,
      );
      continue;
    }

    const buffer = [line];
    index += 1;
    while (index < lines.length && (lines[index] ?? "").trim() !== "" && !isBlockStart(lines[index] ?? "")) {
      buffer.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push(<p key={nextKey()}>{inlines(buffer.join(" "), onOpenWiki)}</p>);
  }

  return blocks;
}

export function Markdown({ source, onOpenWiki }: { source: string; onOpenWiki?: (title: string) => void }) {
  return <div className="quire-prose">{renderMarkdown(source, onOpenWiki)}</div>;
}
