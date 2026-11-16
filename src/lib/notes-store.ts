import { create } from "zustand";
import {
  dailyTitle,
  normalizeNote,
  readPersisted,
  SEED_NOTES,
  sortNotes,
  writePersisted,
  type Note,
  type PersistedNotes,
  type ViewMode,
} from "@/lib/notes";

const HISTORY_PAUSE = 15_000;

type NoteSeed = { title?: string; body?: string; tags?: string[] };

type NotesState = PersistedNotes & {
  createNote: (seed?: NoteSeed) => string;
  updateNote: (id: string, patch: Partial<Pick<Note, "title" | "body">>) => void;
  setTags: (id: string, tags: string[]) => void;
  togglePin: (id: string) => void;
  trashNote: (id: string) => void;
  restoreNote: (id: string) => void;
  purgeNote: (id: string) => void;
  emptyTrash: () => void;
  restoreRevision: (id: string, index: number) => void;
  openDaily: () => string;
  importNotes: (incoming: Note[]) => { added: number; total: number };
  setActive: (id: string) => void;
  setMode: (mode: ViewMode) => void;
  hydrate: (next: PersistedNotes) => void;
};

function persist(state: PersistedNotes) {
  writePersisted({
    notes: state.notes,
    activeId: state.activeId,
    mode: state.mode,
  });
}

function nextId(notes: Note[], currentId: string, trashed: boolean): string | null {
  const pool = sortNotes(notes.filter((note) => note.id !== currentId && Boolean(note.deletedAt) === trashed));
  return pool[0]?.id ?? sortNotes(notes.filter((note) => note.id !== currentId && !note.deletedAt))[0]?.id ?? null;
}

function withHistory(note: Note, patch: Partial<Pick<Note, "title" | "body">>): Note {
  const title = patch.title ?? note.title;
  const body = patch.body ?? note.body;
  if (title === note.title && body === note.body) return note;
  const latest = note.history[0];
  const pause = !latest || Date.now() - latest.at >= HISTORY_PAUSE;
  const worthSaving = Boolean(note.title.trim() || note.body.trim());
  const history =
    pause && worthSaving
      ? [{ title: note.title, body: note.body, at: Date.now() }, ...note.history].slice(0, 20)
      : note.history;
  return { ...note, title, body, history, updatedAt: Date.now() };
}

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: SEED_NOTES,
  activeId: "welcome",
  mode: "write",
  hydrate: (next) => set(next),
  createNote: (seed) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    const note = normalizeNote({
      id,
      title: seed?.title ?? "",
      body: seed?.body ?? "",
      createdAt: now,
      updatedAt: now,
      tags: seed?.tags ?? [],
      pinned: false,
      deletedAt: null,
      history: [],
    });
    set((state) => ({ notes: [note, ...state.notes], activeId: id }));
    persist(get());
    return id;
  },
  updateNote: (id, patch) => {
    set((state) => ({
      notes: state.notes.map((note) => (note.id === id ? withHistory(note, patch) : note)),
    }));
    persist(get());
  },
  setTags: (id, tags) => {
    const current = get().notes.find((note) => note.id === id);
    if (!current) return;
    const next = normalizeNote({ ...current, tags }).tags;
    set((state) => ({
      notes: state.notes.map((note) => (note.id === id ? { ...note, tags: next, updatedAt: Date.now() } : note)),
    }));
    persist(get());
  },
  togglePin: (id) => {
    set((state) => ({
      notes: state.notes.map((note) =>
        note.id === id ? { ...note, pinned: !note.pinned, updatedAt: Date.now() } : note,
      ),
    }));
    persist(get());
  },
  trashNote: (id) => {
    set((state) => {
      const notes = state.notes.map((note) =>
        note.id === id ? { ...note, deletedAt: note.deletedAt ?? Date.now() } : note,
      );
      const activeId = state.activeId === id ? nextId(notes, id, false) : state.activeId;
      return { notes, activeId };
    });
    persist(get());
  },
  restoreNote: (id) => {
    set((state) => ({
      notes: state.notes.map((note) => (note.id === id ? { ...note, deletedAt: null, updatedAt: Date.now() } : note)),
      activeId: id,
    }));
    persist(get());
  },
  purgeNote: (id) => {
    set((state) => {
      const notes = state.notes.filter((note) => note.id !== id);
      const activeId = state.activeId === id ? nextId(state.notes, id, true) : state.activeId;
      return { notes, activeId };
    });
    persist(get());
  },
  emptyTrash: () => {
    set((state) => {
      const notes = state.notes.filter((note) => !note.deletedAt);
      const activeId = notes.some((note) => note.id === state.activeId) ? state.activeId : (sortNotes(notes)[0]?.id ?? null);
      return { notes, activeId };
    });
    persist(get());
  },
  restoreRevision: (id, index) => {
    set((state) => ({
      notes: state.notes.map((note) => {
        if (note.id !== id) return note;
        const revision = note.history[index];
        if (!revision) return note;
        const history = [
          { title: note.title, body: note.body, at: Date.now() },
          ...note.history.filter((_, item) => item !== index),
        ].slice(0, 20);
        return { ...note, title: revision.title, body: revision.body, history, updatedAt: Date.now() };
      }),
    }));
    persist(get());
  },
  openDaily: () => {
    const title = dailyTitle();
    const notes = get().notes;
    const liveMatch = notes.find((note) => !note.deletedAt && note.title === title);
    if (liveMatch) {
      set({ activeId: liveMatch.id });
      persist(get());
      return liveMatch.id;
    }
    const buried = notes.find((note) => note.deletedAt && note.title === title);
    if (buried) {
      set((state) => ({
        notes: state.notes.map((note) =>
          note.id === buried.id ? { ...note, deletedAt: null, updatedAt: Date.now() } : note,
        ),
        activeId: buried.id,
      }));
      persist(get());
      return buried.id;
    }
    return get().createNote({ title });
  },
  importNotes: (incoming) => {
    const known = new Set(get().notes.map((note) => note.id));
    const added = incoming.filter((note) => !known.has(note.id)).length;
    set((state) => {
      const notes = [...state.notes];
      for (const note of incoming.map((item) => normalizeNote(item))) {
        const index = notes.findIndex((item) => item.id === note.id);
        if (index >= 0) notes[index] = note;
        else notes.push(note);
      }
      return { notes, activeId: incoming[0]?.id ?? state.activeId };
    });
    persist(get());
    return { added, total: incoming.length };
  },
  setActive: (id) => {
    set({ activeId: id });
    persist(get());
  },
  setMode: (mode) => {
    set({ mode });
    persist(get());
  },
}));

let didHydrate = false;

export function hydrateNotes() {
  if (didHydrate) return;
  didHydrate = true;
  const saved = readPersisted();
  if (saved) useNotesStore.getState().hydrate(saved);
}
