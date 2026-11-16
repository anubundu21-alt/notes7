import { useImperativeHandle, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type Ref } from "react";
import type { FormatId } from "@/lib/format-markdown";
import {
  applyRichFormat,
  domToMarkdown,
  exitEmptyListItem,
  focusWritableTail,
  handleCodeEnter,
  insertWikiLink,
  markdownToHtml,
  markEmpty,
  settleEditor,
} from "@/lib/rich-text";

export type RichEditorHandle = {
  focus: () => void;
  format: (id: FormatId) => void;
  linkNote: (title: string) => void;
};

export function RichEditor({
  ref,
  noteId,
  initialValue,
  onChange,
  onWiki,
}: {
  ref: Ref<RichEditorHandle>;
  noteId: string;
  initialValue: string;
  onChange: (markdown: string) => void;
  onWiki?: (title: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onWikiRef = useRef(onWiki);
  const valueRef = useRef(initialValue);
  const emittedRef = useRef(initialValue);
  const fixingRef = useRef(false);
  const composingRef = useRef(false);
  onChangeRef.current = onChange;
  onWikiRef.current = onWiki;
  valueRef.current = initialValue;

  const publish = () => {
    const node = editorRef.current;
    if (!node || fixingRef.current || composingRef.current) return;
    fixingRef.current = true;
    try {
      settleEditor(node);
      const markdown = domToMarkdown(node);
      markEmpty(node);
      emittedRef.current = markdown;
      if (markdown !== valueRef.current) onChangeRef.current(markdown);
    } finally {
      fixingRef.current = false;
    }
  };

  useImperativeHandle(ref, () => ({
    focus() {
      editorRef.current?.focus();
    },
    format(id: FormatId) {
      const node = editorRef.current;
      if (!node) return;
      applyRichFormat(node, id);
      publish();
    },
    linkNote(title: string) {
      const node = editorRef.current;
      if (!node) return;
      insertWikiLink(node, title);
      publish();
    },
  }));

  useLayoutEffect(() => {
    const node = editorRef.current;
    if (!node) return;
    node.innerHTML = markdownToHtml(valueRef.current);
    settleEditor(node);
    markEmpty(node);
    emittedRef.current = valueRef.current;
    document.execCommand("defaultParagraphSeparator", false, "p");
  }, [noteId]);

  useLayoutEffect(() => {
    if (initialValue === emittedRef.current) return;
    const node = editorRef.current;
    if (!node) return;
    node.innerHTML = markdownToHtml(initialValue);
    settleEditor(node);
    markEmpty(node);
    emittedRef.current = initialValue;
  }, [initialValue]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      document.execCommand("insertText", false, "  ");
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      const node = editorRef.current;
      if (!node) return;
      if (handleCodeEnter(node) || exitEmptyListItem(node)) {
        event.preventDefault();
        publish();
      }
    }
  };

  return (
    <div
      ref={editorRef}
      role="textbox"
      aria-multiline="true"
      aria-label="Note body"
      data-field="body"
      data-placeholder="Start writing…"
      contentEditable
      spellCheck
      suppressContentEditableWarning
      onInput={publish}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (
          event.key === "Enter" ||
          event.key.startsWith("Arrow") ||
          event.key === "Backspace" ||
          event.key === "Delete"
        ) {
          publish();
        }
      }}
      onMouseUp={() => publish()}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
        publish();
      }}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("a")) event.preventDefault();
      }}
      onPointerDown={(event) => {
        const node = editorRef.current;
        const target = event.target;
        if (target instanceof HTMLElement) {
          const wiki = target.closest("a.quire-wiki");
          if (wiki instanceof HTMLAnchorElement && node?.contains(wiki)) {
            event.preventDefault();
            const title = (wiki.textContent || wiki.dataset.wiki || "").trim();
            if (title) onWikiRef.current?.(title);
            return;
          }
        }
        if (target instanceof HTMLInputElement && target.type === "checkbox") {
          event.preventDefault();
          target.checked = !target.checked;
          publish();
          return;
        }
        if (node && target === node) {
          event.preventDefault();
          focusWritableTail(node);
          publish();
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, text);
      }}
      className="quire-editor quire-prose quire-body quire-scroll mt-3 min-h-0 w-full flex-1 overflow-y-auto"
    />
  );
}
