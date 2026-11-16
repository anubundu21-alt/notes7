import { isNote, normalizeNote, normalizeTag, type Note } from "@/lib/notes";
import { unzip, zipStore } from "@/lib/zip";

function yamlString(value: string): string {
  if (!value || /[:#\n"'\\]/.test(value) || value.trim() !== value) return JSON.stringify(value);
  return value;
}

function unyaml(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function noteToMarkdown(note: Note): string {
  return [
    "---",
    `id: ${note.id}`,
    `title: ${yamlString(note.title)}`,
    `tags: ${note.tags.join(", ")}`,
    `pinned: ${note.pinned ? "true" : "false"}`,
    `created: ${new Date(note.createdAt).toISOString()}`,
    `updated: ${new Date(note.updatedAt).toISOString()}`,
    "---",
    "",
    note.body,
  ].join("\n");
}

export function markdownToNote(text: string): Note | null {
  let body = text.replace(/\r\n/g, "\n");
  const now = Date.now();
  let id = "";
  let title = "";
  let tags: string[] = [];
  let pinned = false;
  let createdAt = now;
  let updatedAt = now;

  if (body.startsWith("---\n")) {
    const end = body.indexOf("\n---\n", 4);
    if (end > 0) {
      const header = body.slice(4, end);
      body = body.slice(end + 5);
      for (const line of header.split("\n")) {
        const split = line.indexOf(":");
        if (split < 1) continue;
        const key = line.slice(0, split).trim();
        const raw = unyaml(line.slice(split + 1).trim());
        if (key === "id") id = raw;
        if (key === "title") title = raw;
        if (key === "tags") tags = raw.split(",").map((tag) => normalizeTag(tag)).filter(Boolean);
        if (key === "pinned") pinned = raw === "true";
        if (key === "created") createdAt = Date.parse(raw) || createdAt;
        if (key === "updated") updatedAt = Date.parse(raw) || updatedAt;
      }
    }
  }

  if (!title) {
    const lines = body.split("\n");
    const index = lines.findIndex((line) => line.trim());
    const heading = index >= 0 ? lines[index]!.trim() : "";
    const marked = heading.match(/^#{1,6}\s+(.*)$/);
    if (marked) {
      title = marked[1]!.trim().slice(0, 120);
      lines.splice(index, 1);
      body = lines.join("\n");
    } else {
      title = heading.slice(0, 120);
    }
  }
  if (!id) id = crypto.randomUUID();
  return normalizeNote({
    id,
    title,
    body: body.replace(/^\n/, ""),
    createdAt,
    updatedAt,
    tags,
    pinned,
    deletedAt: null,
    history: [],
  });
}

function fileName(note: Note, used: Set<string>): string {
  const slug = note.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  let name = `${slug || "note"}.md`;
  if (used.has(name)) name = `${slug || "note"}-${note.id.slice(0, 8)}.md`;
  used.add(name);
  return name;
}

export function exportNotebook(notes: Note[]): Uint8Array {
  const encoder = new TextEncoder();
  const used = new Set<string>();
  const files = notes
    .filter((note) => !note.deletedAt)
    .map((note) => ({
      name: fileName(note, used),
      data: encoder.encode(noteToMarkdown(note)),
    }));
  files.push({
    name: "quire.json",
    data: encoder.encode(JSON.stringify({ version: 1, notes })),
  });
  return zipStore(files);
}

function notesFromJson(text: string): Note[] {
  const data = JSON.parse(text) as { notes?: unknown } | unknown[];
  const list = Array.isArray(data) ? data : data.notes;
  if (!Array.isArray(list)) throw new Error("empty");
  return list.filter(isNote).map((note) => normalizeNote(note));
}

export async function importNotebook(file: File): Promise<Note[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json") || file.type === "application/json") return notesFromJson(await file.text());
  if (name.endsWith(".md") || name.endsWith(".markdown") || file.type === "text/markdown") {
    const note = markdownToNote(await file.text());
    return note ? [note] : [];
  }
  const entries = await unzip(await file.arrayBuffer());
  const json = entries.find((entry) => entry.name === "quire.json" || entry.name.endsWith("/quire.json"));
  if (json) return notesFromJson(new TextDecoder().decode(json.data));
  const notes: Note[] = [];
  for (const entry of entries) {
    if (!entry.name.toLowerCase().endsWith(".md")) continue;
    const note = markdownToNote(new TextDecoder().decode(entry.data));
    if (note) notes.push(note);
  }
  return notes;
}
