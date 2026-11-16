import type { Note } from "@/lib/notes";

const WIKI = /\[\[([^\[\]\n]{1,120})\]\]/g;

export function wikiTitles(body: string): string[] {
  const source = body.replace(/```[\s\S]*?```/g, "");
  const titles: string[] = [];
  for (const match of source.matchAll(WIKI)) {
    const title = match[1]?.trim();
    if (title) titles.push(title);
  }
  return [...new Set(titles)];
}

export function notesLinkingTo(notes: Note[], title: string): Note[] {
  const key = title.trim().toLowerCase();
  if (!key) return [];
  return notes.filter(
    (note) =>
      !note.deletedAt &&
      note.title.trim().toLowerCase() !== key &&
      wikiTitles(note.body).some((item) => item.toLowerCase() === key),
  );
}

export function findLiveByTitle(notes: Note[], title: string): Note | undefined {
  const key = title.trim().toLowerCase();
  if (!key) return undefined;
  return notes.find((note) => !note.deletedAt && note.title.trim().toLowerCase() === key);
}

export type OutlineItem = { level: number; text: string };

export function noteOutline(body: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  let fence = false;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const text = match[2]
      .replace(/\[\[([^\[\]]+)\]\]/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]/g, "")
      .trim();
    if (text) items.push({ level: match[1].length, text });
  }
  return items;
}
