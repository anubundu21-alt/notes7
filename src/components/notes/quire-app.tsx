import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  Columns2,
  Download,
  Eye,
  History,
  Keyboard,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Type,
  Upload,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { Markdown } from "@/components/notes/markdown";
import { FormatToolbar } from "@/components/notes/format-toolbar";
import { RichEditor, type RichEditorHandle } from "@/components/notes/rich-editor";
import type { FormatId } from "@/lib/format-markdown";
import {
  countWords,
  formatEdited,
  listSnippet,
  normalizeTag,
  noteMatches,
  snippetOf,
  sortNotes,
  wordLabel,
  type Note,
  type ViewMode,
} from "@/lib/notes";
import { findLiveByTitle, noteOutline, notesLinkingTo, wikiTitles, type OutlineItem } from "@/lib/links";
import { hydrateNotes, useNotesStore } from "@/lib/notes-store";
import { exportNotebook, importNotebook } from "@/lib/transfer";

const FORMAT_KEY = "quire.formatbar";
const SIDEBAR_KEY = "quire.sidebar";

type Pane = "list" | "note";

const SHORTCUTS: { action: string; keys: string[] }[] = [
  { action: "New note", keys: ["N", "Ctrl/\u2318 N"] },
  { action: "Today's note", keys: ["D"] },
  { action: "Search", keys: ["/", "Ctrl/\u2318 K"] },
  { action: "Write, split, preview", keys: ["Ctrl/\u2318", "Enter"] },
  { action: "Bold", keys: ["Ctrl/\u2318 B"] },
  { action: "Italic", keys: ["Ctrl/\u2318 I"] },
  { action: "Next note", keys: ["J", "Alt \u2193"] },
  { action: "Previous note", keys: ["K", "Alt \u2191"] },
  { action: "Move to trash", keys: ["Ctrl/\u2318 Shift", "\u232b"] },
  { action: "Hide or show notes", keys: ["Ctrl/\u2318 \\"] },
  { action: "Close or go back", keys: ["Esc"] },
  { action: "This list", keys: ["?"] },
];

function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="size-9 shrink-0" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-moss" />
      <path
        d="M9.5 23.5V9h8.2a4.4 4.4 0 0 1 0 8.8H9.5"
        fill="none"
        className="stroke-paper"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17.6 16.6 22.8 24"
        fill="none"
        className="stroke-paper"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (!needle) return text;
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="quire-mark">{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  );
}

function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function trapTab(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const root = event.currentTarget;
  const focusable = [...root.querySelectorAll<HTMLElement>("button, [href], input, textarea, select")].filter(
    (node) => !node.hasAttribute("disabled"),
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function Modal({
  title,
  titleId,
  onClose,
  initialFocus,
  children,
}: {
  title: string;
  titleId: string;
  onClose: () => void;
  initialFocus: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initialFocus.current?.focus();
    return () => previous?.focus();
  }, [initialFocus]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="quire-modal relative z-10 max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-card p-6"
        onKeyDown={trapTab}
      >
        <h2 id={titleId} className="font-serif text-2xl font-semibold tracking-tight text-balance">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function cycleMode(current: ViewMode): ViewMode {
  const wide = window.matchMedia("(min-width: 768px)").matches;
  const order: ViewMode[] = wide ? ["write", "split", "preview"] : ["write", "preview"];
  const index = order.indexOf(current);
  if (index === -1) return "write";
  return order[(index + 1) % order.length] ?? "write";
}

export function QuireApp() {
  const notes = useNotesStore((state) => state.notes);
  const activeId = useNotesStore((state) => state.activeId);
  const mode = useNotesStore((state) => state.mode);
  const createNote = useNotesStore((state) => state.createNote);
  const updateNote = useNotesStore((state) => state.updateNote);
  const setTags = useNotesStore((state) => state.setTags);
  const togglePin = useNotesStore((state) => state.togglePin);
  const trashNote = useNotesStore((state) => state.trashNote);
  const restoreNote = useNotesStore((state) => state.restoreNote);
  const purgeNote = useNotesStore((state) => state.purgeNote);
  const emptyTrash = useNotesStore((state) => state.emptyTrash);
  const restoreRevision = useNotesStore((state) => state.restoreRevision);
  const openDaily = useNotesStore((state) => state.openDaily);
  const importNotes = useNotesStore((state) => state.importNotes);
  const setActive = useNotesStore((state) => state.setActive);
  const setMode = useNotesStore((state) => state.setMode);

  const [query, setQuery] = useState("");
  const [pane, setPane] = useState<Pane>("list");
  const [library, setLibrary] = useState<"notes" | "trash">("notes");
  const [tag, setTag] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [formatOpen, setFormatOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [wide, setWide] = useState(false);
  const [immersed, setImmersed] = useState(false);

  const now = useNow();
  const searchRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<RichEditorHandle>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const helpCloseRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const historyCloseRef = useRef<HTMLButtonElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const pendingTitleFocus = useRef(false);
  const formatRef = useRef<(id: FormatId) => void>(() => {});
  const sidebarOpenRef = useRef(true);

  const live = useMemo(() => notes.filter((note) => !note.deletedAt), [notes]);
  const trashed = useMemo(() => notes.filter((note) => note.deletedAt), [notes]);
  const tags = useMemo(() => [...new Set(live.flatMap((note) => note.tags))].sort(), [live]);
  const filtered = useMemo(() => {
    const pool = library === "trash" ? trashed : live;
    const tagged = tag && library === "notes" ? pool.filter((note) => note.tags.includes(tag)) : pool;
    return sortNotes(tagged).filter((note) => noteMatches(note, query));
  }, [library, live, trashed, tag, query]);
  const active = notes.find((note) => note.id === activeId) ?? null;
  const confirmNote = notes.find((note) => note.id === confirmId) ?? null;
  const tabId = filtered.some((note) => note.id === activeId) ? activeId : (filtered[0]?.id ?? null);
  const outgoing = active ? wikiTitles(active.body) : [];
  const incoming = active ? notesLinkingTo(live, active.title).filter((note) => note.id !== active.id) : [];
  const outline = useMemo(() => (active ? noteOutline(active.body) : []), [active]);
  const outlineInSidebar = Boolean(active) && sidebarOpen && outline.length > 0 && (wide || pane === "list");
  const linkChoices = live
    .filter((note) => note.title && note.id !== activeId && note.title.toLowerCase().includes(linkQuery.trim().toLowerCase()))
    .slice(0, 6);

  useEffect(() => {
    if (tag && !tags.includes(tag)) setTag(null);
  }, [tag, tags]);

  useEffect(() => {
    if (filtered.some((note) => note.id === activeId)) return;
    if (!query.trim() && !tag && library === "notes") return;
    const first = filtered[0];
    if (first) setActive(first.id);
  }, [query, tag, library, filtered, activeId, setActive]);

  useEffect(() => {
    hydrateNotes();
    setFormatOpen(localStorage.getItem(FORMAT_KEY) === "1");
    const open = localStorage.getItem(SIDEBAR_KEY) !== "0";
    sidebarOpenRef.current = open;
    setSidebarOpen(open);
  }, []);

  useEffect(() => {
    setImmersed(false);
  }, [activeId, mode]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.dataset.field !== "body") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.key === "Escape" || event.key === "Tab") return;
      setImmersed(true);
    };
    const onMove = () => setImmersed(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const apply = () => {
      setWide(!media.matches);
      if (media.matches && useNotesStore.getState().mode === "split") {
        useNotesStore.getState().setMode("write");
      }
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!pendingTitleFocus.current) return;
    pendingTitleFocus.current = false;
    titleRef.current?.focus();
  });

  const api = useRef({
    helpOpen,
    confirmId,
    confirmEmpty,
    historyOpen,
    linkOpen,
    filteredIds: filtered.map((note) => note.id),
    activeId,
  });
  api.current = {
    helpOpen,
    confirmId,
    confirmEmpty,
    historyOpen,
    linkOpen,
    filteredIds: filtered.map((note) => note.id),
    activeId,
  };

  const openNote = (id: string) => {
    setActive(id);
    setPane("note");
  };

  const move = (direction: 1 | -1) => {
    const ids = api.current.filteredIds;
    if (ids.length === 0) return;
    const current = ids.indexOf(api.current.activeId ?? "");
    const nextIndex =
      current === -1
        ? direction === 1
          ? 0
          : ids.length - 1
        : (current + direction + ids.length) % ids.length;
    const nextId = ids[nextIndex];
    if (!nextId) return;
    const listHasFocus = listRef.current?.contains(document.activeElement) ?? false;
    setActive(nextId);
    requestAnimationFrame(() => {
      const element = document.getElementById(`note-${nextId}`);
      element?.scrollIntoView({ block: "nearest" });
      if (listHasFocus && element instanceof HTMLElement) element.focus();
    });
  };

  const focusSearch = () => {
    if (window.matchMedia("(max-width: 767px)").matches) setPane("list");
    else {
      sidebarOpenRef.current = true;
      setSidebarOpen(true);
      localStorage.setItem(SIDEBAR_KEY, "1");
    }
    requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  };

  const setSidebar = (open: boolean) => {
    sidebarOpenRef.current = open;
    setSidebarOpen(open);
    localStorage.setItem(SIDEBAR_KEY, open ? "1" : "0");
    if (!open) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-sidebar-show]")?.focus());
    }
  };

  const onCreate = () => {
    createNote();
    setLibrary("notes");
    setTag(null);
    if (useNotesStore.getState().mode === "preview") setMode("write");
    setQuery("");
    setPane("note");
    pendingTitleFocus.current = true;
  };

  const onToday = () => {
    openDaily();
    setLibrary("notes");
    setTag(null);
    setQuery("");
    if (useNotesStore.getState().mode === "preview") setMode("write");
    setPane("note");
  };

  const openWiki = (title: string) => {
    const label = title.trim();
    if (!label) return;
    const all = useNotesStore.getState().notes;
    const found = findLiveByTitle(all, label);
    setLibrary("notes");
    setTag(null);
    setQuery("");
    if (found) {
      openNote(found.id);
      return;
    }
    const buried = all.find(
      (note) => note.deletedAt && note.title.trim().toLowerCase() === label.toLowerCase(),
    );
    if (buried) {
      restoreNote(buried.id);
      setPane("note");
      setNotice("Restored from the trash.");
      return;
    }
    createNote({ title: label });
    if (useNotesStore.getState().mode === "preview") setMode("write");
    setPane("note");
  };

  const onExport = () => {
    const bytes = exportNotebook(useNotesStore.getState().notes);
    const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
      type: "application/zip",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "quire-notes.zip";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Exported a zip of your notes.");
  };

  const onImportFile = async (file: File) => {
    try {
      const incoming = await importNotebook(file);
      if (incoming.length === 0) {
        setNotice("Nothing to import.");
        return;
      }
      const result = importNotes(incoming);
      setLibrary("notes");
      setTag(null);
      setQuery("");
      setPane("note");
      setNotice(
        result.added === result.total
          ? `Imported ${result.added} ${result.added === 1 ? "note" : "notes"}.`
          : `Updated the notebook from ${result.total} ${result.total === 1 ? "note" : "notes"}.`,
      );
    } catch {
      setNotice("Could not read that file.");
    }
  };

  const askDelete = () => {
    const id = useNotesStore.getState().activeId;
    if (!id) return;
    setConfirmId(id);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = isTypingTarget(event.target);
      const mod = event.metaKey || event.ctrlKey;
      const state = api.current;

      if (event.key === "Escape") {
        if (state.helpOpen) {
          event.preventDefault();
          setHelpOpen(false);
          return;
        }
        if (state.historyOpen) {
          event.preventDefault();
          setHistoryOpen(false);
          return;
        }
        if (state.linkOpen) {
          event.preventDefault();
          setLinkOpen(false);
          return;
        }
        if (state.confirmEmpty) {
          event.preventDefault();
          setConfirmEmpty(false);
          return;
        }
        if (state.confirmId) {
          event.preventDefault();
          setConfirmId(null);
          return;
        }
        if (typing && event.target instanceof HTMLElement && event.target.dataset.field === "search") {
          return;
        }
        if (typing && event.target instanceof HTMLElement) {
          event.preventDefault();
          setImmersed(false);
          event.target.blur();
          return;
        }
        setPane("list");
        return;
      }

      if (state.helpOpen || state.confirmId || state.confirmEmpty || state.historyOpen || state.linkOpen) return;

      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        onCreate();
        return;
      }
      if (mod && event.key === "Enter") {
        event.preventDefault();
        setMode(cycleMode(useNotesStore.getState().mode));
        return;
      }
      if (mod && !event.altKey && (event.key === "\\" || event.code === "Backslash")) {
        event.preventDefault();
        if (window.matchMedia("(max-width: 767px)").matches) {
          setPane((current) => (current === "list" ? "note" : "list"));
          return;
        }
        const next = !sidebarOpenRef.current;
        sidebarOpenRef.current = next;
        setSidebarOpen(next);
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
        if (!next) {
          requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-sidebar-show]")?.focus());
        }
        return;
      }
      if (mod && event.shiftKey && event.key === "Backspace") {
        event.preventDefault();
        askDelete();
        return;
      }
      if (
        mod &&
        !event.altKey &&
        event.target instanceof HTMLElement &&
        event.target.closest("[data-field=body]")
      ) {
        const key = event.key.toLowerCase();
        if (!event.shiftKey && key === "b") {
          event.preventDefault();
          formatRef.current("bold");
          return;
        }
        if (!event.shiftKey && key === "i") {
          event.preventDefault();
          formatRef.current("italic");
          return;
        }
      }
      if (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        move(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (typing || mod || event.altKey) return;

      if (event.key === "?") {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        onCreate();
        return;
      }
      if (event.key.toLowerCase() === "d") {
        event.preventDefault();
        onToday();
        return;
      }
      if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        move(1);
        return;
      }
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        move(-1);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMode]);

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const current = filtered.find((note) => note.id === activeId) ?? filtered[0];
      if (!current) return;
      openNote(current.id);
      pendingTitleFocus.current = true;
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (query) setQuery("");
      else event.currentTarget.blur();
    }
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      move(event.key === "ArrowDown" ? 1 : -1);
    }
  };

  const formatBody = (id: FormatId) => {
    bodyRef.current?.format(id);
  };
  formatRef.current = formatBody;

  const confirmDelete = () => {
    if (!confirmId) return;
    const removing = confirmId;
    const forever = notes.find((note) => note.id === removing)?.deletedAt;
    setConfirmId(null);
    if (forever) {
      purgeNote(removing);
      if (!useNotesStore.getState().notes.some((note) => note.deletedAt)) setLibrary("notes");
    } else trashNote(removing);
    if (library === "notes" && useNotesStore.getState().notes.every((note) => note.deletedAt)) setPane("list");
  };

  const jumpToHeading = (index: number) => {
    const headingIn = (selector: string) => {
      const root = document.querySelector(selector);
      return root?.querySelectorAll("h1, h2, h3, h4, h5, h6")[index] ?? null;
    };
    const target = headingIn("[data-field=body]") ?? headingIn("[data-preview]");
    if (target instanceof HTMLElement) target.scrollIntoView({ block: "center" });
    setPane("note");
    setImmersed(false);
  };

  const showWrite = mode !== "preview";
  const showPreview = mode !== "write";
  const countLabel = query.trim()
    ? `${filtered.length} ${filtered.length === 1 ? "match" : "matches"}`
    : library === "trash"
      ? `${trashed.length} in trash`
      : `${live.length} ${live.length === 1 ? "note" : "notes"}`;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-paper text-ink">
      <aside
        aria-label="Notes"
        className={clsx(
          "h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-sidebar md:shrink-0 md:transition-[width] md:duration-200",
          pane === "note" ? "hidden" : "flex",
          sidebarOpen ? "md:flex md:w-80 md:border-r md:border-line" : "md:flex md:w-0",
        )}
        inert={wide && !sidebarOpen ? true : undefined}
      >
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <Mark />
          <div className="min-w-0 flex-1">
            <p className="font-serif text-xl font-semibold tracking-tight">Quire</p>
            <p className="mt-1 text-xs text-muted">On this device</p>
          </div>
          <button
            type="button"
            onClick={() => setSidebar(false)}
            aria-label="Hide notes"
            title="Hide notes"
            aria-keyshortcuts="Control+\\ Meta+\\"
            className="hidden size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-paper-deep hover:text-ink md:inline-flex"
          >
            <PanelLeftClose className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onCreate}
            aria-keyshortcuts="Control+N Meta+N"
            className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-moss px-3 text-sm font-medium text-paper"
          >
            <Plus className="size-4" strokeWidth={2.25} aria-hidden="true" />
            New
          </button>
        </div>

        <div role="search" className="px-4 pb-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              data-field="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search notes"
              aria-label="Search notes"
              autoComplete="off"
              className="h-11 w-full rounded-lg border border-line bg-paper pr-11 pl-10 text-base text-ink placeholder:text-muted"
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                className="absolute top-0 right-0 flex size-11 items-center justify-center text-muted"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : (
              <span className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 md:block">
                <kbd className="quire-kbd">/</kbd>
              </span>
            )}
          </div>
        </div>

        <div className="mx-4 mb-3 flex rounded-xl bg-paper-deep p-1" role="group" aria-label="Library">
          <button
            type="button"
            aria-pressed={library === "notes"}
            onClick={() => setLibrary("notes")}
            className={clsx(
              "h-11 flex-1 rounded-lg text-sm",
              library === "notes" ? "bg-card font-medium text-ink" : "text-muted",
            )}
          >
            Notes
          </button>
          <button
            type="button"
            aria-pressed={library === "trash"}
            onClick={() => {
              setLibrary("trash");
              setTag(null);
            }}
            className={clsx(
              "h-11 flex-1 rounded-lg text-sm",
              library === "trash" ? "bg-card font-medium text-ink" : "text-muted",
            )}
          >
            Trash{trashed.length > 0 ? ` ${trashed.length}` : ""}
          </button>
        </div>

        {library === "notes" && tags.length > 0 ? (
          <div className="quire-scroll mb-2 flex min-w-0 gap-2 overflow-x-auto px-4 pb-1">
            {tags.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={tag === item}
                onClick={() => setTag(tag === item ? null : item)}
                className={clsx(
                  "h-11 shrink-0 rounded-full px-3 text-sm",
                  tag === item ? "bg-moss text-paper" : "bg-paper text-ink",
                )}
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}

        <p className="px-4 pb-2 text-xs text-muted" aria-live="polite">
          {countLabel}
          {notice ? <span className="mt-1 block text-moss">{notice}</span> : null}
        </p>

        <div
          ref={listRef}
          role="listbox"
          aria-label="Note list"
          aria-activedescendant={
            activeId && filtered.some((note) => note.id === activeId) ? `note-${activeId}` : undefined
          }
          onKeyDown={onListKeyDown}
          className="quire-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-10 text-center">
              <p className="font-serif text-lg text-balance">
                {library === "trash"
                  ? "Trash is empty"
                  : live.length === 0
                    ? "No notes yet"
                    : "No matching notes"}
              </p>
              <p className="mt-1 text-sm text-pretty text-muted">
                {library === "trash"
                  ? "Deleted notes wait here until you restore or remove them."
                  : live.length === 0
                    ? "Start one when you're ready."
                    : `Nothing contains \u201c${query.trim() || tag || ""}\u201d.`}
              </p>
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="mt-4 inline-flex h-11 items-center rounded-lg border border-line bg-card px-4 text-sm"
                >
                  Clear search
                </button>
              ) : null}
            </div>
          ) : (
            filtered.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                query={query}
                selected={note.id === activeId}
                tabbable={note.id === tabId}
                now={now}
                onSelect={() => openNote(note.id)}
              />
            ))
          )}
        </div>

        {outlineInSidebar ? (
          <div className="quire-scroll max-h-56 shrink-0 overflow-y-auto border-t border-line px-2 py-2">
            <NoteOutline items={outline} onJump={jumpToHeading} />
          </div>
        ) : null}

        <footer className="shrink-0 border-t border-line px-4 py-3 text-xs text-muted">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onToday}
              className="inline-flex h-11 items-center rounded-lg border border-line bg-card px-3 text-sm text-ink"
            >
              Today
            </button>
            <button
              type="button"
              onClick={onExport}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-sm text-ink"
            >
              <Download className="size-4" aria-hidden="true" />
              Export
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-sm text-ink"
            >
              <Upload className="size-4" aria-hidden="true" />
              Import
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,.json,.zip,text/markdown,application/json,application/zip"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void onImportFile(file);
              }}
            />
          </div>
          {library === "trash" && trashed.length > 0 ? (
            <button
              type="button"
              onClick={() => setConfirmEmpty(true)}
              className="mt-2 inline-flex h-11 items-center text-sm text-danger"
            >
              Empty trash
            </button>
          ) : (
            <p className="mt-2">Saved on this device</p>
          )}
          <p className="mt-2 hidden items-center gap-2 md:flex">
            <kbd className="quire-kbd">N</kbd>
            <span>new</span>
            <kbd className="quire-kbd">D</kbd>
            <span>today</span>
            <kbd className="quire-kbd">/</kbd>
            <span>search</span>
          </p>
        </footer>
      </aside>

      <main
        aria-label="Editor"
        className={clsx(
          "h-full min-h-0 w-full min-w-0 flex-col",
          pane === "list" ? "hidden md:flex" : "flex",
        )}
      >
        {active ? (
          <>
            <header className="flex min-h-16 shrink-0 items-center gap-2 px-3 md:px-5">
              <button
                type="button"
                onClick={() => setPane("list")}
                className="inline-flex h-11 items-center gap-1 rounded-lg pr-2 pl-1 text-sm text-ink md:hidden"
              >
                <ChevronLeft className="size-5" aria-hidden="true" />
                Notes
              </button>
              {!sidebarOpen ? (
                <button
                  type="button"
                  data-sidebar-show
                  onClick={() => setSidebar(true)}
                  aria-label="Show notes"
                  title="Show notes"
                  className="hidden size-11 items-center justify-center rounded-lg text-muted hover:bg-paper-deep hover:text-ink md:inline-flex"
                >
                  <PanelLeftOpen className="size-5" aria-hidden="true" />
                </button>
              ) : null}
              <div className="flex-1" />
              <div role="group" aria-label="View" className="flex rounded-xl bg-paper-deep p-1">
                <ModeButton
                  label="Write"
                  icon={<PenLine className="size-4" aria-hidden="true" />}
                  pressed={mode === "write"}
                  onClick={() => setMode("write")}
                />
                <ModeButton
                  label="Split"
                  icon={<Columns2 className="size-4" aria-hidden="true" />}
                  pressed={mode === "split"}
                  onClick={() => setMode("split")}
                  className="hidden md:inline-flex"
                />
                <ModeButton
                  label="Preview"
                  icon={<Eye className="size-4" aria-hidden="true" />}
                  pressed={mode === "preview"}
                  onClick={() => setMode("preview")}
                />
              </div>
              <button
                type="button"
                aria-label={active.deletedAt ? "Delete forever" : "Move to trash"}
                title={active.deletedAt ? "Delete forever" : "Move to trash"}
                onClick={askDelete}
                className="inline-flex size-11 items-center justify-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 className="size-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Keyboard shortcuts"
                title="Keyboard shortcuts"
                onClick={() => setHelpOpen(true)}
                className="inline-flex size-11 items-center justify-center rounded-lg text-muted hover:bg-paper-deep hover:text-ink"
              >
                <Keyboard className="size-5" aria-hidden="true" />
              </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              {showWrite ? (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <div
                    className={clsx(
                      "mx-auto flex min-h-0 w-full min-w-0 flex-1 flex-col px-5 pt-2 pb-6 md:px-10 md:pt-4",
                      mode === "split" ? "max-w-none" : "max-w-2xl",
                    )}
                  >
                    <textarea
                      ref={titleRef}
                      data-field="title"
                      rows={1}
                      value={active.title}
                      aria-label="Note title"
                      placeholder="Untitled"
                      onChange={(event) => updateNote(active.id, { title: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          bodyRef.current?.focus();
                        }
                      }}
                      className="quire-title quire-editor shrink-0"
                    />
                    {active.deletedAt ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-paper-deep px-3 py-2">
                        <p className="min-w-0 flex-1 text-sm text-pretty">This note is in the trash.</p>
                        <button
                          type="button"
                          onClick={() => {
                            restoreNote(active.id);
                            setLibrary("notes");
                            setNotice("Restored.");
                          }}
                          className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-moss px-3 text-sm font-medium text-paper"
                        >
                          <RotateCcw className="size-4" aria-hidden="true" />
                          Restore
                        </button>
                      </div>
                    ) : null}
                    <div className={clsx("mt-3 flex flex-wrap items-center gap-2", immersed && "hidden")}>
                      <button
                        type="button"
                        aria-pressed={active.pinned}
                        aria-label={active.pinned ? "Unpin note" : "Pin note"}
                        title={active.pinned ? "Unpin" : "Pin"}
                        onClick={() => togglePin(active.id)}
                        className={clsx(
                          "inline-flex size-11 items-center justify-center rounded-lg",
                          active.pinned ? "bg-paper-deep text-moss" : "text-muted hover:bg-paper-deep hover:text-ink",
                        )}
                      >
                        <Pin className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="Note history"
                        title="History"
                        onClick={() => setHistoryOpen(true)}
                        className="inline-flex size-11 items-center justify-center rounded-lg text-muted hover:bg-paper-deep hover:text-ink"
                      >
                        <History className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="Link a note"
                        title="Link a note"
                        onClick={() => {
                          setLinkQuery("");
                          setLinkOpen(true);
                        }}
                        className="inline-flex h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-muted hover:bg-paper-deep hover:text-ink"
                      >
                        <Link2 className="size-4" aria-hidden="true" />
                        Link
                      </button>
                      <button
                        type="button"
                        aria-pressed={formatOpen}
                        aria-label={formatOpen ? "Hide formatting" : "Show formatting"}
                        title={formatOpen ? "Hide formatting" : "Formatting"}
                        onClick={() => {
                          setFormatOpen((open) => {
                            const next = !open;
                            localStorage.setItem(FORMAT_KEY, next ? "1" : "0");
                            return next;
                          });
                        }}
                        className={clsx(
                          "inline-flex h-11 items-center gap-1.5 rounded-lg px-2 text-sm",
                          formatOpen ? "bg-paper-deep text-ink" : "text-muted hover:bg-paper-deep hover:text-ink",
                        )}
                      >
                        <Type className="size-4" aria-hidden="true" />
                        Format
                      </button>
                      {active.tags.map((item) => (
                        <span key={item} className="inline-flex h-11 items-center rounded-full bg-paper-deep pl-3 text-sm">
                          <button type="button" onClick={() => { setTag(item); setLibrary("notes"); }} className="text-ink">
                            {item}
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove tag ${item}`}
                            onClick={() => setTags(active.id, active.tags.filter((entry) => entry !== item))}
                            className="inline-flex size-11 items-center justify-center text-muted"
                          >
                            <X className="size-3.5" aria-hidden="true" />
                          </button>
                        </span>
                      ))}
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const next = normalizeTag(tagDraft);
                          if (!next || active.tags.includes(next)) {
                            setTagDraft("");
                            return;
                          }
                          setTags(active.id, [...active.tags, next]);
                          setTagDraft("");
                        }}
                      >
                        <input
                          value={tagDraft}
                          onChange={(event) => setTagDraft(event.target.value)}
                          aria-label="Add a tag"
                          placeholder="Add tag"
                          className="h-11 w-28 rounded-full border border-line bg-paper px-3 text-sm text-ink placeholder:text-muted"
                        />
                      </form>
                    </div>
                    {formatOpen && !immersed ? <FormatToolbar onFormat={formatBody} /> : null}
                    <RichEditor
                      key={active.id}
                      ref={bodyRef}
                      noteId={active.id}
                      initialValue={active.body}
                      onChange={(body) => updateNote(active.id, { body })}
                      onWiki={openWiki}
                    />
                    {!immersed ? <NoteLinks outgoing={outgoing} incoming={incoming} onOpen={openWiki} /> : null}
                    {!immersed && !outlineInSidebar ? (
                      <div className="quire-scroll mt-3 max-h-48 shrink-0 overflow-y-auto">
                        <NoteOutline items={outline} onJump={jumpToHeading} />
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {showPreview ? (
                <div
                  className={clsx(
                    "quire-scroll min-h-0 min-w-0 flex-1 overflow-y-auto",
                    mode === "split" && "border-t border-line md:border-t-0 md:border-l",
                  )}
                >
                  <article
                    data-preview
                    className={clsx(
                      "mx-auto w-full px-5 py-6 md:px-10 md:py-8",
                      mode === "split" ? "max-w-none" : "max-w-2xl",
                    )}
                  >
                    <h1
                      className={clsx(
                        "quire-title text-balance",
                        active.title ? "text-ink" : "text-muted",
                      )}
                    >
                      {active.title || "Untitled"}
                    </h1>
                    {active.body.trim() ? (
                      <div className="mt-5">
                        <Markdown source={active.body} onOpenWiki={openWiki} />
                      </div>
                    ) : (
                      <p className="mt-5 text-muted">Nothing to preview yet.</p>
                    )}
                    <NoteLinks outgoing={outgoing} incoming={incoming} onOpen={openWiki} />
                    {!outlineInSidebar ? <NoteOutline items={outline} onJump={jumpToHeading} /> : null}
                  </article>
                </div>
              ) : null}
            </div>

            <footer
              className={clsx(
                "flex shrink-0 items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-muted md:px-8",
                immersed && "hidden",
              )}
            >
              <span className="tabular-nums">{wordLabel(countWords(`${active.title}\n${active.body}`))}</span>
              {notice ? <span className="min-w-0 truncate text-moss">{notice}</span> : null}
              {now ? (
                <time
                  dateTime={new Date(active.updatedAt).toISOString()}
                  title={new Date(active.updatedAt).toLocaleString()}
                  className="tabular-nums"
                >
                  Edited {formatEdited(active.updatedAt, now)}
                </time>
              ) : (
                <span>Saved on this device</span>
              )}
            </footer>
          </>
        ) : (
          <div className="relative flex flex-1 flex-col items-center justify-center px-6 text-center">
            {!sidebarOpen ? (
              <button
                type="button"
                data-sidebar-show
                onClick={() => setSidebar(true)}
                aria-label="Show notes"
                title="Show notes"
                className="absolute top-3 left-3 hidden size-11 items-center justify-center rounded-lg text-muted hover:bg-paper-deep hover:text-ink md:inline-flex"
              >
                <PanelLeftOpen className="size-5" aria-hidden="true" />
              </button>
            ) : null}
            <Mark />
            <h1 className="mt-4 font-serif text-3xl font-semibold text-balance">Nothing in the notebook</h1>
            <p className="mt-2 max-w-xs text-pretty text-muted">
              Start a note. It stays in this browser, and you can find it again from the list.
            </p>
            <button
              type="button"
              onClick={onCreate}
              className="mt-6 inline-flex h-11 items-center gap-1.5 rounded-lg bg-moss px-4 text-sm font-medium text-paper"
            >
              <Plus className="size-4" aria-hidden="true" />
              New note
            </button>
          </div>
        )}
      </main>

      {helpOpen ? (
        <Modal title="Shortcuts" titleId="quire-help-title" onClose={() => setHelpOpen(false)} initialFocus={helpCloseRef}>
          <p className="mt-2 text-sm text-pretty text-muted">
            Single-key shortcuts work when you aren't typing. On a Mac, \u2318 stands in for Ctrl.
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {SHORTCUTS.map((row) => (
              <li key={row.action} className="flex items-center justify-between gap-4 text-sm">
                <span>{row.action}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {row.keys.map((key) => (
                    <kbd key={key} className="quire-kbd">
                      {key}
                    </kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex justify-end">
            <button
              ref={helpCloseRef}
              type="button"
              onClick={() => setHelpOpen(false)}
              className="inline-flex h-11 items-center rounded-lg bg-moss px-4 text-sm font-medium text-paper"
            >
              Close
            </button>
          </div>
        </Modal>
      ) : null}

      {confirmNote ? (
        <Modal
          title={confirmNote.deletedAt ? "Delete forever?" : "Move to trash?"}
          titleId="quire-delete-title"
          onClose={() => setConfirmId(null)}
          initialFocus={keepRef}
        >
          <p className="mt-2 text-sm text-pretty text-muted">
            {confirmNote.deletedAt
              ? `\u201c${confirmNote.title || "Untitled"}\u201d will be removed from this browser. This can\u2019t be undone.`
              : `\u201c${confirmNote.title || "Untitled"}\u201d stays in the trash until you restore it or delete it forever.`}
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              ref={keepRef}
              type="button"
              onClick={() => setConfirmId(null)}
              className="inline-flex h-11 items-center rounded-lg border border-line bg-card px-4 text-sm"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              className="inline-flex h-11 items-center rounded-lg bg-danger px-4 text-sm font-medium text-paper"
            >
              {confirmNote.deletedAt ? "Delete forever" : "Move to trash"}
            </button>
          </div>
        </Modal>
      ) : null}

      {confirmEmpty ? (
        <Modal title="Empty the trash?" titleId="quire-empty-title" onClose={() => setConfirmEmpty(false)} initialFocus={keepRef}>
          <p className="mt-2 text-sm text-pretty text-muted">
            {trashed.length} {trashed.length === 1 ? "note" : "notes"} will be removed from this browser. This can\u2019t be undone.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              ref={keepRef}
              type="button"
              onClick={() => setConfirmEmpty(false)}
              className="inline-flex h-11 items-center rounded-lg border border-line bg-card px-4 text-sm"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmEmpty(false);
                emptyTrash();
                setLibrary("notes");
                setNotice("Trash emptied.");
              }}
              className="inline-flex h-11 items-center rounded-lg bg-danger px-4 text-sm font-medium text-paper"
            >
              Empty trash
            </button>
          </div>
        </Modal>
      ) : null}

      {historyOpen && active ? (
        <Modal title="History" titleId="quire-history-title" onClose={() => setHistoryOpen(false)} initialFocus={historyCloseRef}>
          <p className="mt-2 text-sm text-pretty text-muted">
            A version is kept when you pause while writing. Restoring puts the current text into this list.
          </p>
          {active.history.length === 0 ? (
            <p className="mt-4 text-sm">No earlier versions yet.</p>
          ) : (
            <ul className="mt-4 flex max-h-80 flex-col gap-3 overflow-y-auto">
              {active.history.map((revision, index) => (
                <li key={`${revision.at}-${index}`} className="rounded-xl border border-line bg-paper px-3 py-3">
                  <p className="text-sm font-medium">{revision.title || "Untitled"}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{snippetOf(revision.body) || "Empty note"}</p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <time className="text-xs text-muted tabular-nums" dateTime={new Date(revision.at).toISOString()}>
                      {now ? formatEdited(revision.at, now) : "Saved"}
                    </time>
                    <button
                      type="button"
                      onClick={() => {
                        restoreRevision(active.id, index);
                        setHistoryOpen(false);
                        setNotice("Restored an earlier version.");
                      }}
                      className="inline-flex h-11 items-center rounded-lg bg-moss px-3 text-sm font-medium text-paper"
                    >
                      Restore
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6 flex justify-end">
            <button
              ref={historyCloseRef}
              type="button"
              onClick={() => setHistoryOpen(false)}
              className="inline-flex h-11 items-center rounded-lg border border-line bg-card px-4 text-sm"
            >
              Close
            </button>
          </div>
        </Modal>
      ) : null}

      {linkOpen ? (
        <Modal title="Link a note" titleId="quire-link-title" onClose={() => setLinkOpen(false)} initialFocus={linkInputRef}>
          <p className="mt-2 text-sm text-pretty text-muted">
            Pick a note, or type a new title. Opening the link later creates the note if it does not exist yet.
          </p>
          <form
            className="mt-4"
            onSubmit={(event) => {
              event.preventDefault();
              const title = linkQuery.trim();
              if (!title) return;
              bodyRef.current?.linkNote(title);
              setLinkOpen(false);
            }}
          >
            <input
              ref={linkInputRef}
              value={linkQuery}
              onChange={(event) => setLinkQuery(event.target.value)}
              aria-label="Note to link"
              placeholder="Note title"
              className="h-11 w-full rounded-lg border border-line bg-paper px-3 text-base text-ink placeholder:text-muted"
            />
            {linkChoices.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1">
                {linkChoices.map((note) => (
                  <li key={note.id}>
                    <button
                      type="button"
                      onClick={() => {
                        bodyRef.current?.linkNote(note.title);
                        setLinkOpen(false);
                      }}
                      className="flex h-11 w-full items-center rounded-lg px-3 text-left text-sm hover:bg-paper-deep"
                    >
                      {note.title}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLinkOpen(false)}
                className="inline-flex h-11 items-center rounded-lg border border-line bg-card px-4 text-sm"
              >
                Cancel
              </button>
              <button type="submit" className="inline-flex h-11 items-center rounded-lg bg-moss px-4 text-sm font-medium text-paper">
                Insert link
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

function NoteOutline({ items, onJump }: { items: OutlineItem[]; onJump: (index: number) => void }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="On this page" className="px-1">
      <p className="px-2 text-xs text-muted">On this page</p>
      <ul className="mt-1">
        {items.map((item, index) => (
          <li key={`${item.level}-${item.text}-${index}`}>
            <button
              type="button"
              onClick={() => onJump(index)}
              className={clsx(
                "flex h-11 w-full min-w-0 items-center truncate rounded-lg pr-2 text-left text-sm text-ink hover:bg-paper-deep",
                item.level >= 4 ? "pl-10" : item.level === 3 ? "pl-6" : "pl-2",
              )}
            >
              {item.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function NoteLinks({
  outgoing,
  incoming,
  onOpen,
}: {
  outgoing: string[];
  incoming: Note[];
  onOpen: (title: string) => void;
}) {
  if (outgoing.length === 0 && incoming.length === 0) return null;
  return (
    <div className="mt-4 shrink-0 border-t border-line pt-3">
      {outgoing.length > 0 ? (
        <div>
          <p className="text-xs text-muted">Links</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {outgoing.map((title) => (
              <button
                key={title}
                type="button"
                onClick={() => onOpen(title)}
                className="inline-flex h-11 items-center rounded-full bg-paper-deep px-3 text-sm text-ink"
              >
                {title}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {incoming.length > 0 ? (
        <div className={outgoing.length > 0 ? "mt-3" : undefined}>
          <p className="text-xs text-muted">Linked from</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {incoming.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => onOpen(note.title)}
                className="inline-flex h-11 items-center rounded-full bg-paper-deep px-3 text-sm text-ink"
              >
                {note.title || "Untitled"}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ModeButton({
  label,
  icon,
  pressed,
  onClick,
  className,
}: {
  label: string;
  icon: ReactNode;
  pressed: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={twMerge(
        "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2.5 text-sm sm:px-3",
        pressed ? "bg-card text-ink" : "text-muted hover:text-ink",
        className,
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function NoteRow({
  note,
  query,
  selected,
  tabbable,
  now,
  onSelect,
}: {
  note: Note;
  query: string;
  selected: boolean;
  tabbable: boolean;
  now: number | null;
  onSelect: () => void;
}) {
  const snippet = listSnippet(note, query);
  return (
    <button
      id={`note-${note.id}`}
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={tabbable ? 0 : -1}
      onClick={onSelect}
      className={clsx(
        "quire-row flex w-full flex-col gap-1 rounded-lg border-l-4 px-3 py-3 text-left",
        selected ? "border-moss bg-card" : "border-transparent hover:bg-paper/70",
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {note.pinned && !note.deletedAt ? <Pin className="size-4 shrink-0 text-moss" aria-hidden="true" /> : null}
        <span className={clsx("block truncate", note.title ? "font-medium text-ink" : "text-muted italic")}>
          {note.title ? <Highlight text={note.title} query={query} /> : "Untitled"}
        </span>
      </span>
      <span className="block truncate text-sm text-muted">
        {snippet ? <Highlight text={snippet} query={query} /> : "Empty note"}
      </span>
      {now ? (
        <time
          dateTime={new Date(note.updatedAt).toISOString()}
          title={new Date(note.updatedAt).toLocaleString()}
          className="text-xs text-muted tabular-nums"
        >
          {formatEdited(note.deletedAt ?? note.updatedAt, now)}
        </time>
      ) : (
        <span className="text-xs text-muted">&nbsp;</span>
      )}
    </button>
  );
}
