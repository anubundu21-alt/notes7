import type { ReactNode } from "react";
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  SquareCode,
  Strikethrough,
} from "lucide-react";
import type { FormatId } from "@/lib/format-markdown";

type Tool = {
  id: FormatId;
  label: string;
  icon: ReactNode;
  shortcut?: string;
};

const GROUPS: Tool[][] = [
  [
    { id: "bold", label: "Bold", shortcut: "Ctrl/⌘ B", icon: <Bold className="size-4" aria-hidden="true" /> },
    { id: "italic", label: "Italic", shortcut: "Ctrl/⌘ I", icon: <Italic className="size-4" aria-hidden="true" /> },
    { id: "strike", label: "Strikethrough", icon: <Strikethrough className="size-4" aria-hidden="true" /> },
  ],
  [
    { id: "h2", label: "Heading", icon: <Heading2 className="size-4" aria-hidden="true" /> },
    { id: "h3", label: "Small heading", icon: <Heading3 className="size-4" aria-hidden="true" /> },
  ],
  [
    { id: "bullet", label: "Bulleted list", icon: <List className="size-4" aria-hidden="true" /> },
    { id: "number", label: "Numbered list", icon: <ListOrdered className="size-4" aria-hidden="true" /> },
    { id: "task", label: "Checklist", icon: <ListChecks className="size-4" aria-hidden="true" /> },
    { id: "quote", label: "Quote", icon: <Quote className="size-4" aria-hidden="true" /> },
  ],
  [
    { id: "code", label: "Inline code", icon: <Code className="size-4" aria-hidden="true" /> },
    { id: "codeblock", label: "Code block", icon: <SquareCode className="size-4" aria-hidden="true" /> },
    { id: "link", label: "Link", icon: <Link className="size-4" aria-hidden="true" /> },
  ],
  [{ id: "rule", label: "Divider", icon: <Minus className="size-4" aria-hidden="true" /> }],
];

export function FormatToolbar({ onFormat }: { onFormat: (id: FormatId) => void }) {
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      aria-orientation="horizontal"
      className="quire-scroll mt-4 flex w-full min-w-0 shrink-0 items-center gap-0.5 overflow-x-auto rounded-xl bg-paper-deep p-1"
    >
      {GROUPS.map((group, index) => (
        <div key={group[0]?.id ?? index} className="flex shrink-0 items-center">
          {index > 0 ? <span className="mx-1 h-6 w-px shrink-0 bg-line" aria-hidden="true" /> : null}
          {group.map((tool) => (
            <button
              key={tool.id}
              type="button"
              aria-label={tool.label}
              title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
              aria-keyshortcuts={tool.id === "bold" ? "Control+B Meta+B" : tool.id === "italic" ? "Control+I Meta+I" : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onFormat(tool.id)}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-card hover:text-ink"
            >
              {tool.icon}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
