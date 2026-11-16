export type ViewMode = "write" | "split" | "preview";

export type NoteRevision = {
  title: string;
  body: string;
  at: number;
};

export type Note = {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  pinned: boolean;
  deletedAt: number | null;
  history: NoteRevision[];
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const openedAt = Date.now();

export const SEED_NOTES: Note[] = [
  {
    id: "welcome",
    title: "Welcome to Quire",
    body: `A quiet notebook that stays in this browser. Nothing is sent anywhere.

## How to use it

Search narrows the list as you type. New notes jump to the top. Open preview when you want the page, not the marks.

- N — new note, when you aren't typing
- D — today's note
- / — search
- Ctrl+Enter or ⌘+Enter — write, split, preview

> Leave a little blank space. That's part of the page.`,
    createdAt: openedAt - 2 * DAY,
    updatedAt: openedAt - 42 * MINUTE,
    tags: ["start"],
    pinned: true,
    deletedAt: null,
    history: [],
  },
  {
    id: "saturday",
    title: "Saturday, unhurried",
    body: `- [x] Farmers market, the early tables
- [ ] Library returns — the green novel is due
- [ ] Walk the long way home

Onion soup: butter, thyme, a heel of bread.

> The afternoon stays empty on purpose.`,
    createdAt: openedAt - 3 * DAY,
    updatedAt: openedAt - 26 * HOUR,
    tags: ["home"],
    pinned: false,
    deletedAt: null,
    history: [],
  },
  {
    id: "reading",
    title: "Books on the table",
    body: `Three slim books, and no rush.

### In progress

1. *The Living Mountain* — Nan Shepherd
2. *Essays* — Montaigne

### Next

A reread of *A Room of One's Own*.

See also [[Welcome to Quire]].`,
    createdAt: openedAt - 6 * DAY,
    updatedAt: openedAt - 4 * DAY,
    tags: ["books"],
    pinned: false,
    deletedAt: null,
    history: [],
  },
];

export const STORAGE_KEY = "quire.notes.v1";

export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    const pin = Number(b.pinned && !b.deletedAt) - Number(a.pinned && !a.deletedAt);
    if (pin !== 0) return pin;
    const left = a.deletedAt ?? a.updatedAt;
    const right = b.deletedAt ?? b.updatedAt;
    return right - left || b.createdAt - a.createdAt;
  });
}

export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

export function dailyTitle(date = new Date()): string {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function isRevision(value: unknown): value is NoteRevision {
  if (!value || typeof value !== "object") return false;
  const revision = value as NoteRevision;
  return typeof revision.title === "string" && typeof revision.body === "string" && typeof revision.at === "number";
}

export function normalizeNote(note: Note): Note {
  const tags = Array.isArray(note.tags)
    ? [...new Set(note.tags.filter((tag) => typeof tag === "string").map((tag) => normalizeTag(tag)).filter(Boolean))]
    : [];
  const history = Array.isArray(note.history) ? note.history.filter(isRevision).slice(0, 20) : [];
  return {
    ...note,
    tags,
    pinned: note.pinned === true,
    deletedAt: typeof note.deletedAt === "number" ? note.deletedAt : null,
    history,
  };
}

export function snippetOf(body: string): string {
  for (const raw of body.split("\n")) {
    let line = raw.trim();
    if (!line || line.startsWith("```") || /^(-{3,}|\*{3,}|_{3,})$/.test(line)) continue;
    line = line.replace(/^#{1,6}\s+/, "");
    line = line.replace(/^>\s?/, "");
    line = line.replace(/^([-*+]|\d+\.)\s+/, "");
    line = line.replace(/^\[[ xX]\]\s+/, "");
    line = line.replace(/\[\[([^\[\]]+)\]\]/g, "$1");
    line = line.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    line = line.replace(/[`*_~]/g, "");
    line = line.trim();
    if (line) return line;
  }
  return "";
}

export function listSnippet(note: Note, query: string): string {
  const q = query.trim().toLowerCase();
  if (!q || note.title.toLowerCase().includes(q)) return snippetOf(note.body);
  const line = note.body.split("\n").find((entry) => entry.toLowerCase().includes(q));
  if (!line) return snippetOf(note.body);
  return snippetOf(line) || snippetOf(note.body);
}

export function noteMatches(note: Note, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return note.title.toLowerCase().includes(q) || note.body.toLowerCase().includes(q) || note.tags.some((tag) => tag.includes(q));
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function wordLabel(count: number): string {
  return `${count} ${count === 1 ? "word" : "words"}`;
}

export function formatEdited(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function isNote(value: unknown): value is Note {
  if (!value || typeof value !== "object") return false;
  const note = value as Note;
  return (
    typeof note.id === "string" &&
    note.id.length > 0 &&
    typeof note.title === "string" &&
    typeof note.body === "string" &&
    typeof note.createdAt === "number" &&
    typeof note.updatedAt === "number"
  );
}

export function isViewMode(value: unknown): value is ViewMode {
  return value === "write" || value === "split" || value === "preview";
}

export type PersistedNotes = {
  notes: Note[];
  activeId: string | null;
  mode: ViewMode;
};

export function readPersisted(): PersistedNotes | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<PersistedNotes>;
    if (!Array.isArray(data.notes) || !data.notes.every(isNote)) return null;
    const notes = data.notes.map((note) => normalizeNote(note));
    const activeId =
      typeof data.activeId === "string" && notes.some((note) => note.id === data.activeId)
        ? data.activeId
        : (sortNotes(notes)[0]?.id ?? null);
    return {
      notes,
      activeId,
      mode: isViewMode(data.mode) ? data.mode : "write",
    };
  } catch {
    return null;
  }
}

export function writePersisted(data: PersistedNotes) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
