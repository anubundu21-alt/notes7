export type FormatId =
  | "bold"
  | "italic"
  | "strike"
  | "h2"
  | "h3"
  | "bullet"
  | "number"
  | "task"
  | "quote"
  | "code"
  | "codeblock"
  | "link"
  | "rule";

export type TextEdit = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

function edit(value: string, selectionStart: number, selectionEnd: number): TextEdit {
  return { value, selectionStart, selectionEnd };
}

function wrapped(value: string, start: number, end: number, before: string, after: string): boolean {
  const beforeStart = start - before.length;
  const afterEnd = end + after.length;
  if (beforeStart < 0 || afterEnd > value.length) return false;
  if (value.slice(beforeStart, start) !== before || value.slice(end, afterEnd) !== after) return false;
  if (before === "*" && value[beforeStart - 1] === "*") return false;
  if (after === "*" && value[afterEnd] === "*") return false;
  return true;
}

function toggleWrap(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  placeholder: string,
): TextEdit {
  const selected = value.slice(start, end);
  if (wrapped(value, start, end, before, after)) {
    const next = value.slice(0, start - before.length) + selected + value.slice(end + after.length);
    const caret = start - before.length;
    return edit(next, caret, caret + selected.length);
  }
  if (
    selected.startsWith(before) &&
    selected.endsWith(after) &&
    selected.length > before.length + after.length
  ) {
    const inner = selected.slice(before.length, selected.length - after.length);
    const next = value.slice(0, start) + inner + value.slice(end);
    return edit(next, start, start + inner.length);
  }
  const inner = selected || placeholder;
  const next = value.slice(0, start) + before + inner + after + value.slice(end);
  const selStart = start + before.length;
  return edit(next, selStart, selStart + inner.length);
}

function lineBounds(value: string, start: number, end: number): { from: number; to: number } {
  const from = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  let until = end;
  if (until > start && value[until - 1] === "\n") until -= 1;
  const lineEnd = value.indexOf("\n", until);
  return { from, to: lineEnd === -1 ? value.length : lineEnd };
}

function applyLines(
  value: string,
  start: number,
  end: number,
  transform: (lines: string[]) => string[],
): TextEdit {
  const { from, to } = lineBounds(value, start, end);
  const lines = value.slice(from, to).split("\n");
  const nextLines = transform(lines);
  const nextBlock = nextLines.join("\n");
  const next = value.slice(0, from) + nextBlock + value.slice(to);
  if (start !== end) return edit(next, from, from + nextBlock.length);

  const beforeCaret = value.slice(from, start);
  const lineIndex = beforeCaret.split("\n").length - 1;
  const oldLine = lines[lineIndex] ?? "";
  const newLine = nextLines[lineIndex] ?? "";
  const lineOffset =
    from + lines.slice(0, lineIndex).reduce((sum, line) => sum + line.length + 1, 0);
  const column = start - lineOffset;
  const nextColumn = Math.min(newLine.length, Math.max(0, column + (newLine.length - oldLine.length)));
  const caret =
    from + nextLines.slice(0, lineIndex).reduce((sum, line) => sum + line.length + 1, 0) + nextColumn;
  return edit(next, caret, caret);
}

function togglePrefix(lines: string[], prefix: string, emptyFallback: string): string[] {
  if (lines.length === 1 && lines[0] === "") return [emptyFallback];
  const filled = lines.filter((line) => line.length > 0);
  const all = filled.length > 0 && filled.every((line) => line.startsWith(prefix));
  if (all) return lines.map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line));
  return lines.map((line) => (line.length === 0 || line.startsWith(prefix) ? line : `${prefix}${line}`));
}

function toggleHeading(lines: string[], marker: string): string[] {
  if (lines.length === 1 && lines[0] === "") return [marker];
  const filled = lines.filter((line) => line.length > 0);
  const all = filled.length > 0 && filled.every((line) => line.startsWith(marker));
  return lines.map((line) => {
    if (line.length === 0) return line;
    const stripped = line.replace(/^#{1,6}\s+/, "");
    return all ? stripped : `${marker}${stripped}`;
  });
}

function toggleNumbered(lines: string[]): string[] {
  if (lines.length === 1 && lines[0] === "") return ["1. "];
  const numbered = /^\d+\.\s/;
  const filled = lines.filter((line) => line.length > 0);
  const all = filled.length > 0 && filled.every((line) => numbered.test(line));
  if (all) return lines.map((line) => line.replace(numbered, ""));
  let count = 1;
  return lines.map((line) => {
    if (line.length === 0) return line;
    const stripped = line.replace(numbered, "");
    return `${count++}. ${stripped}`;
  });
}

function toggleTask(lines: string[]): string[] {
  const task = /^-\s\[[ xX]\]\s/;
  if (lines.length === 1 && lines[0] === "") return ["- [ ] "];
  const filled = lines.filter((line) => line.length > 0);
  const all = filled.length > 0 && filled.every((line) => task.test(line));
  if (all) return lines.map((line) => line.replace(task, ""));
  return lines.map((line) => {
    if (line.length === 0 || task.test(line)) return line;
    if (line.startsWith("- ")) return `- [ ] ${line.slice(2)}`;
    return `- [ ] ${line}`;
  });
}

function applyLink(value: string, start: number, end: number): TextEdit {
  const selected = value.slice(start, end);
  if (selected) {
    const next = `${value.slice(0, start)}[${selected}](https://)${value.slice(end)}`;
    const urlStart = start + selected.length + 3;
    return edit(next, urlStart, urlStart + "https://".length);
  }
  const next = `${value.slice(0, start)}[link text](https://)${value.slice(end)}`;
  return edit(next, start + 1, start + 1 + "link text".length);
}

function applyFence(value: string, start: number, end: number): TextEdit {
  const selected = value.slice(start, end);
  const inner = selected || "code";
  const lead = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
  const trail = end < value.length && value[end] !== "\n" ? "\n" : "";
  const block = `${lead}\`\`\`\n${inner}\n\`\`\`${trail}`;
  const next = value.slice(0, start) + block + value.slice(end);
  const selStart = start + lead.length + 4;
  return edit(next, selStart, selStart + inner.length);
}

function applyRule(value: string, start: number, end: number): TextEdit {
  const lead = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
  const insert = `${lead}---\n`;
  const next = value.slice(0, start) + insert + value.slice(end);
  const caret = start + insert.length;
  return edit(next, caret, caret);
}

export function applyFormat(value: string, start: number, end: number, id: FormatId): TextEdit {
  const safeStart = Math.max(0, Math.min(start, value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, value.length));
  switch (id) {
    case "bold":
      return toggleWrap(value, safeStart, safeEnd, "**", "**", "bold");
    case "italic":
      return toggleWrap(value, safeStart, safeEnd, "*", "*", "italic");
    case "strike":
      return toggleWrap(value, safeStart, safeEnd, "~~", "~~", "struck");
    case "code":
      return toggleWrap(value, safeStart, safeEnd, "`", "`", "code");
    case "h2":
      return applyLines(value, safeStart, safeEnd, (lines) => toggleHeading(lines, "## "));
    case "h3":
      return applyLines(value, safeStart, safeEnd, (lines) => toggleHeading(lines, "### "));
    case "bullet":
      return applyLines(value, safeStart, safeEnd, (lines) => togglePrefix(lines, "- ", "- "));
    case "number":
      return applyLines(value, safeStart, safeEnd, toggleNumbered);
    case "task":
      return applyLines(value, safeStart, safeEnd, toggleTask);
    case "quote":
      return applyLines(value, safeStart, safeEnd, (lines) => togglePrefix(lines, "> ", "> "));
    case "codeblock":
      return applyFence(value, safeStart, safeEnd);
    case "link":
      return applyLink(value, safeStart, safeEnd);
    case "rule":
      return applyRule(value, safeStart, safeEnd);
  }
}
