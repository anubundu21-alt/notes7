import type { FormatId } from "@/lib/format-markdown";

const ZWSP = "\u200b";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;")
    .replace(/"/g, "&" + "quot;");
}

function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^mailto:/i.test(trimmed)) return trimmed;
  return null;
}

function inlinesHtml(input: string): string {
  let html = "";
  let index = 0;
  while (index < input.length) {
    if (input[index] === "`") {
      const end = input.indexOf("`", index + 1);
      if (end > index + 1) {
        html += `<code>${escapeHtml(input.slice(index + 1, end))}</code>`;
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
          html += `<span class="quire-image">${escapeHtml(alt || "Image")}</span>`;
          index = end + 1;
          continue;
        }
      }
    }

    if (input.startsWith("[[", index)) {
      const end = input.indexOf("]]", index + 2);
      const title = end > index + 2 ? input.slice(index + 2, end).trim() : "";
      if (title && title.length <= 120 && !title.includes("[")) {
        html += `<a class="quire-wiki" href="#" data-wiki="${escapeHtml(title)}">${escapeHtml(title)}</a>`;
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
            html += `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${inlinesHtml(input.slice(index + 1, close))}</a>`;
            index = end + 1;
            continue;
          }
        }
      }
    }

    if (input.startsWith("***", index)) {
      const end = input.indexOf("***", index + 3);
      if (end > index + 3) {
        html += `<strong><em>${inlinesHtml(input.slice(index + 3, end))}</em></strong>`;
        index = end + 3;
        continue;
      }
    }

    if (input.startsWith("**", index) || input.startsWith("__", index)) {
      const marker = input.slice(index, index + 2);
      const end = input.indexOf(marker, index + 2);
      if (end > index + 2) {
        html += `<strong>${inlinesHtml(input.slice(index + 2, end))}</strong>`;
        index = end + 2;
        continue;
      }
    }

    if (input.startsWith("~~", index)) {
      const end = input.indexOf("~~", index + 2);
      if (end > index + 2) {
        html += `<s>${inlinesHtml(input.slice(index + 2, end))}</s>`;
        index = end + 2;
        continue;
      }
    }

    const marker = input[index];
    if (
      (marker === "*" || marker === "_") &&
      input[index + 1] &&
      input[index + 1] !== " " &&
      input[index + 1] !== marker
    ) {
      const end = input.indexOf(marker, index + 1);
      if (end > index + 1 && input[end - 1] !== " ") {
        html += `<em>${inlinesHtml(input.slice(index + 1, end))}</em>`;
        index = end + 1;
        continue;
      }
    }

    html += escapeHtml(input[index] ?? "");
    index += 1;
  }
  return html;
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

export function markdownToHtml(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;

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
      blocks.push(`<pre><code>${escapeHtml(buffer.join("\n"))}</code></pre>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push("<hr>");
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1]?.length ?? 1, 6);
      blocks.push(`<h${level}>${inlinesHtml(heading[2] ?? "")}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buffer: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        buffer.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote><p>${inlinesHtml(buffer.join(" "))}</p></blockquote>`);
      continue;
    }

    if (isListLine(line)) {
      const ordered = isOrdered(line);
      const items: string[] = [];
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
            `<li class="task-item"><input type="checkbox" tabindex="-1" aria-label="${checked ? "Done" : "Not done"}"${checked ? " checked" : ""}><span>${inlinesHtml(task[2] ?? "")}</span></li>`,
          );
        } else {
          tasksOnly = false;
          items.push(`<li>${inlinesHtml(raw)}</li>`);
        }
        index += 1;
      }
      const tag = ordered ? "ol" : "ul";
      blocks.push(`<${tag}${tasksOnly ? ' class="task"' : ""}>${items.join("")}</${tag}>`);
      continue;
    }

    const buffer = [line];
    index += 1;
    while (index < lines.length && (lines[index] ?? "").trim() !== "" && !isBlockStart(lines[index] ?? "")) {
      buffer.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push(`<p>${inlinesHtml(buffer.join(" "))}</p>`);
  }

  return blocks.length > 0 ? blocks.join("") : `<p>${ZWSP}</p>`;
}

function inlineToMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").replace(/\u00a0/g, " ").replace(/\u200b/g, "");
  }
  if (!(node instanceof HTMLElement)) return "";
  const tag = node.tagName;
  if (tag === "INPUT") return "";
  if (tag === "BR") return "\n";
  if (tag === "UL" || tag === "OL") return "";
  const inner = [...node.childNodes].map((child) => inlineToMd(child)).join("");
  if (tag === "STRONG" || tag === "B") return inner.trim() ? `**${inner}**` : "";
  if (tag === "EM" || tag === "I") return inner.trim() ? `*${inner}*` : "";
  if (tag === "S" || tag === "STRIKE" || tag === "DEL") return inner.trim() ? `~~${inner}~~` : "";
  if (tag === "CODE") return inner ? `\`${inner.replace(/\n/g, " ")}\`` : "";
  if (tag === "A") {
    if (node.classList.contains("quire-wiki")) {
      const label = (inner.trim() || node.dataset.wiki || "").replace(/[\[\]]/g, "");
      return label ? `[[${label}]]` : "";
    }
    const href = safeUrl(node.getAttribute("href") ?? "");
    const label = inner.trim();
    return href && label ? `[${label}](${href})` : label;
  }
  return inner;
}

function liPlain(li: HTMLElement): string {
  const clone = li.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("input, ul, ol").forEach((node) => node.remove());
  return inlineToMd(clone)
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

function listToMd(list: HTMLElement, indent = ""): string {
  const ordered = list.tagName === "OL";
  const lines: string[] = [];
  let count = 1;
  for (const child of list.children) {
    if (!(child instanceof HTMLElement) || child.tagName !== "LI") continue;
    const checkbox = [...child.children].find(
      (element) => element instanceof HTMLInputElement && element.type === "checkbox",
    );
    const text = liPlain(child);
    const prefix =
      checkbox instanceof HTMLInputElement
        ? `${indent}- [${checkbox.checked ? "x" : " "}] `
        : ordered
          ? `${indent}${count}. `
          : `${indent}- `;
    lines.push(`${prefix}${text}`.trimEnd());
    count += 1;
    for (const nested of child.children) {
      if (nested instanceof HTMLElement && (nested.tagName === "UL" || nested.tagName === "OL")) {
        const nestedMarkdown = listToMd(nested, `${indent}  `);
        if (nestedMarkdown) lines.push(nestedMarkdown);
      }
    }
  }
  return lines.join("\n");
}

function blockToMd(element: HTMLElement): string | null {
  const tag = element.tagName;
  if (tag === "UL" || tag === "OL") return listToMd(element) || null;
  if (tag === "HR") return "---";
  if (tag === "PRE") {
    const code = prePlain(element).replace(/\n+$/, "");
    return `\`\`\`\n${code}\n\`\`\``;
  }
  if (/^H[1-6]$/.test(tag)) {
    const text = inlineToMd(element).replace(/\s+/g, " ").trim();
    return text ? `${"#".repeat(Number(tag.slice(1)))} ${text}` : null;
  }
  if (tag === "BLOCKQUOTE") {
    const chunks: string[] = [];
    for (const child of element.childNodes) {
      if (child instanceof HTMLElement && (child.tagName === "P" || child.tagName === "DIV")) {
        const text = inlineToMd(child)
          .replace(/\s*\n\s*/g, " ")
          .trim();
        if (text) chunks.push(text);
      } else {
        const text = inlineToMd(child).trim();
        if (text) chunks.push(text);
      }
    }
    const text = chunks.join(" ").trim();
    return text
      ? text
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")
      : null;
  }
  if (tag === "P" || tag === "DIV") {
    const text = inlineToMd(element)
      .replace(/[ \t]*\n[ \t]*/g, "\n")
      .trim();
    return text ? text.replace(/\n{2,}/g, "\n\n") : null;
  }
  const text = inlineToMd(element).trim();
  return text || null;
}

export function domToMarkdown(root: HTMLElement): string {
  const parts: string[] = [];
  for (const child of root.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? "").replace(/[\u00a0\u200b]/g, " ").trim();
      if (text) parts.push(text);
      continue;
    }
    if (child instanceof HTMLElement) {
      const markdown = blockToMd(child);
      if (markdown) parts.push(markdown);
    }
  }
  return parts
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function markEmpty(root: HTMLElement) {
  const text = (root.textContent ?? "").replace(/[\u00a0\u200b]/g, "").trim();
  const structural = root.querySelector("hr, img, li, pre");
  root.dataset.empty = !text && !structural ? "true" : "false";
}

export function normalizeEditor(root: HTMLElement) {
  root.querySelectorAll("ul.task > li").forEach((li) => {
    let checkbox = [...li.children].find(
      (element): element is HTMLInputElement => element instanceof HTMLInputElement && element.type === "checkbox",
    );
    if (!checkbox) {
      checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      li.prepend(checkbox);
    }
    checkbox.tabIndex = -1;
    checkbox.setAttribute("aria-label", checkbox.checked ? "Done" : "Not done");
    li.classList.add("task-item");
  });
}

function plainText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\u200b/g, "").trim();
}

function setCaret(node: Node, offset: number) {
  const max = node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : node.childNodes.length;
  const range = document.createRange();
  range.setStart(node, Math.max(0, Math.min(offset, max)));
  range.collapse(true);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function selectionInside(element: HTMLElement): boolean {
  const selection = document.getSelection();
  const anchor = selection?.anchorNode;
  if (!anchor || !selection.isCollapsed) return false;
  return anchor === element || element.contains(anchor);
}

function cleanTextKeepingCaret(node: Text) {
  const raw = node.textContent ?? "";
  if (!raw.includes(ZWSP)) return;
  const selection = document.getSelection();
  if (selection && !selection.isCollapsed && selection.rangeCount > 0 && selection.getRangeAt(0).intersectsNode(node)) {
    return;
  }
  const real = raw.replace(/\u200b/g, "");
  const focused = !!(selection?.isCollapsed && selection.anchorNode === node);
  const nextOffset = focused ? raw.slice(0, selection?.anchorOffset ?? 0).replace(/\u200b/g, "").length : 0;
  node.textContent = real || ZWSP;
  if (focused) setCaret(node, real ? nextOffset : 0);
}

function cleanTextNodes(scope: HTMLElement) {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  for (const node of nodes) {
    if (!node.isConnected || node.parentElement?.closest("pre")) continue;
    cleanTextKeepingCaret(node);
  }
}

function fillEmptyLine(element: HTMLElement) {
  if (!element.isConnected || element.closest("pre")) return;
  if (element.querySelector("p, div, blockquote, pre, ul, ol, h1, h2, h3, h4, h5, h6, img, hr, input")) return;
  if (plainText(element.textContent ?? "")) {
    cleanTextNodes(element);
    return;
  }
  const onlyAnchor =
    element.childNodes.length === 1 &&
    element.firstChild?.nodeType === Node.TEXT_NODE &&
    element.firstChild.textContent === ZWSP;
  const focused = selectionInside(element);
  if (!onlyAnchor) element.replaceChildren(document.createTextNode(ZWSP));
  if (focused && element.firstChild) setCaret(element.firstChild, 0);
}

function hasVisibleContent(element: HTMLElement): boolean {
  if (plainText(element.textContent ?? "")) return true;
  return !!element.querySelector("img, hr, input, li, pre");
}

function shouldHoist(element: HTMLElement, root: HTMLElement): boolean {
  const parent = element.parentElement;
  if (!parent || parent === root || !root.contains(element)) return false;
  const tag = element.tagName;
  const parentTag = parent.tagName;
  if ((tag === "UL" || tag === "OL") && parentTag === "LI") return false;
  if ((tag === "P" || tag === "DIV") && (parentTag === "BLOCKQUOTE" || parentTag === "LI")) return false;
  return /^(P|DIV|BLOCKQUOTE|PRE|UL|OL|H[1-6]|HR)$/.test(tag);
}

function hoistBlock(node: HTMLElement) {
  const parent = node.parentElement;
  if (!parent) return;
  const after = document.createElement(parent.tagName.toLowerCase());
  if (parent.className) after.className = parent.className;
  let sibling = node.nextSibling;
  while (sibling) {
    const next = sibling.nextSibling;
    after.append(sibling);
    sibling = next;
  }
  parent.after(node);
  if (after.childNodes.length) node.after(after);
  if (!hasVisibleContent(parent)) parent.remove();
  if (after.isConnected && !hasVisibleContent(after)) after.remove();
}

function unwrapNestedBlocks(root: HTMLElement) {
  for (let guard = 0; guard < 50; guard += 1) {
    const target = [...root.querySelectorAll("blockquote, pre, ul, ol, h1, h2, h3, h4, h5, h6, hr, p, div")].find(
      (element): element is HTMLElement => element instanceof HTMLElement && shouldHoist(element, root),
    );
    if (!target) return;
    hoistBlock(target);
  }
}

function snapInvisibleCaret(root: HTMLElement) {
  const selection = document.getSelection();
  if (!selection?.isCollapsed || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  const container = range.startContainer;
  if (container !== root && !root.contains(container)) return;
  if (range.getClientRects().length > 0) return;
  if (container.nodeType === Node.TEXT_NODE) {
    const text = container as Text;
    if (!(text.textContent ?? "").length && !text.parentElement?.closest("pre")) {
      text.textContent = ZWSP;
      setCaret(text, 0);
    }
    return;
  }
  if (!(container instanceof HTMLElement) || container.closest("pre")) return;
  const offset = range.startOffset;
  const next = container.childNodes[offset] ?? null;
  const previous = offset > 0 ? container.childNodes[offset - 1] : null;
  if (next?.nodeType === Node.TEXT_NODE) {
    setCaret(next, 0);
    return;
  }
  if (previous?.nodeType === Node.TEXT_NODE) {
    setCaret(previous, previous.textContent?.length ?? 0);
    return;
  }
  const anchor = document.createTextNode(ZWSP);
  if (next) container.insertBefore(anchor, next);
  else container.append(anchor);
  setCaret(anchor, 0);
}

function stripLooseText(root: HTMLElement) {
  for (const node of [...root.childNodes]) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const text = node.textContent ?? "";
    if (!plainText(text)) {
      const selected = document.getSelection()?.anchorNode === node;
      let next: Node | null = node.nextSibling;
      while (next && next.nodeType === Node.TEXT_NODE) next = next.nextSibling;
      node.remove();
      if (selected && next instanceof HTMLElement) placeCaret(next, true);
      continue;
    }
    const paragraph = document.createElement("p");
    paragraph.textContent = text.replace(/\u200b/g, "");
    node.replaceWith(paragraph);
  }
}

function pruneEmptyChrome(root: HTMLElement) {
  root.querySelectorAll("h1, h2, h3, h4, h5, h6, blockquote").forEach((element) => {
    if (!(element instanceof HTMLElement)) return;
    if (plainText(element.textContent ?? "")) return;
    if (element.querySelector("img, pre, ul, ol, hr")) return;
    if (selectionInside(element)) return;
    element.remove();
  });
}

export function settleEditor(root: HTMLElement) {
  unwrapNestedBlocks(root);
  normalizeEditor(root);
  root.querySelectorAll("p, h1, h2, h3, h4, h5, h6, blockquote, li, span").forEach((element) => {
    if (element instanceof HTMLElement) fillEmptyLine(element);
  });
  pruneEmptyChrome(root);
  stripLooseText(root);
  ensureWritableTail(root);
  snapInvisibleCaret(root);
}

function selectionIn(root: HTMLElement): Selection | null {
  const selection = document.getSelection();
  if (!selection) return null;
  if (selection.anchorNode && (selection.anchorNode === root || root.contains(selection.anchorNode))) {
    return selection;
  }
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

function closestBlock(root: HTMLElement): HTMLElement | null {
  const selection = document.getSelection();
  let node: Node | null = selection?.anchorNode ?? null;
  if (!node || (node !== root && !root.contains(node))) return null;
  while (node && node !== root) {
    if (node instanceof HTMLElement) {
      const tag = node.tagName;
      if (/^(P|DIV|LI|BLOCKQUOTE|PRE|H[1-6])$/.test(tag)) return node;
    }
    node = node.parentNode;
  }
  return null;
}

function toggleHeading(root: HTMLElement, tag: "h2" | "h3") {
  const block = closestBlock(root);
  const current = block?.closest(tag);
  document.execCommand("formatBlock", false, current && root.contains(current) ? "p" : tag);
}

function toggleQuote(root: HTMLElement) {
  const quote = closestBlock(root)?.closest("blockquote");
  if (quote && root.contains(quote)) {
    const fragment = document.createDocumentFragment();
    const children = [...quote.childNodes];
    if (children.length === 0) {
      const paragraph = document.createElement("p");
      paragraph.innerHTML = "<br>";
      fragment.append(paragraph);
    } else {
      children.forEach((child) => fragment.append(child));
    }
    quote.replaceWith(fragment);
    return;
  }
  document.execCommand("formatBlock", false, "blockquote");
}

function applyInlineCode(root: HTMLElement) {
  const selection = selectionIn(root);
  if (!selection || selection.rangeCount === 0) return;
  const anchor = selection.anchorNode;
  const parent = anchor instanceof Element ? anchor : anchor?.parentElement;
  const code = parent?.closest("code");
  if (code && root.contains(code) && !code.closest("pre")) {
    code.replaceWith(document.createTextNode(code.textContent ?? ""));
    return;
  }
  if (selection.isCollapsed) {
    const element = document.createElement("code");
    element.textContent = "code";
    selection.getRangeAt(0).insertNode(element);
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  const range = selection.getRangeAt(0);
  const element = document.createElement("code");
  element.append(range.extractContents());
  range.insertNode(element);
  const next = document.createRange();
  next.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(next);
}

function emptyParagraph(): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.textContent = ZWSP;
  return paragraph;
}

function textAnchor(element: HTMLElement, atStart: boolean): Text | null {
  if (element.closest("pre") || /^(UL|OL|HR|PRE)$/.test(element.tagName)) return null;
  if (element.tagName === "LI" && element.querySelector(":scope > input")) {
    const span = element.querySelector(":scope > span");
    if (span instanceof HTMLElement) return textAnchor(span, atStart);
  }
  const real = plainText(element.textContent ?? "");
  const structural = element.querySelector("img, input, ul, ol, pre, hr");
  if (!real && !structural) {
    const simple = [...element.childNodes].every(
      (node) => node.nodeType === Node.TEXT_NODE || node instanceof HTMLBRElement,
    );
    if (simple || element.childNodes.length === 0) {
      const text = document.createTextNode(ZWSP);
      element.replaceChildren(text);
      return text;
    }
  }
  const edge = atStart ? element.firstChild : element.lastChild;
  if (edge?.nodeType === Node.TEXT_NODE) return edge as Text;
  if (edge instanceof HTMLElement && /^(SPAN|STRONG|EM|B|I|S|A|CODE)$/.test(edge.tagName)) {
    return textAnchor(edge, atStart);
  }
  const text = document.createTextNode(ZWSP);
  if (atStart) element.prepend(text);
  else element.append(text);
  return text;
}

function placeCaret(element: HTMLElement, atStart: boolean) {
  const range = document.createRange();
  const anchor = textAnchor(element, atStart);
  if (anchor) {
    range.setStart(anchor, atStart ? 0 : (anchor.textContent?.length ?? 0));
    range.collapse(true);
  } else {
    range.selectNodeContents(element);
    range.collapse(atStart);
  }
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function ensureWritableTail(root: HTMLElement) {
  const last = root.lastElementChild;
  if (
    !last ||
    last.tagName === "PRE" ||
    last.tagName === "HR" ||
    last.tagName === "UL" ||
    last.tagName === "OL" ||
    last.tagName === "BLOCKQUOTE"
  ) {
    root.append(emptyParagraph());
  }
}

export function focusWritableTail(root: HTMLElement) {
  ensureWritableTail(root);
  const last = root.lastElementChild;
  if (!(last instanceof HTMLElement)) return;
  const empty = !plainText(last.textContent ?? "");
  placeCaret(last, empty);
  root.focus();
}
function toggleCodeBlock(root: HTMLElement) {
  const block = closestBlock(root);
  const pre = block?.closest("pre");
  if (pre && root.contains(pre)) {
    const paragraph = document.createElement("p");
    paragraph.textContent = plainText(prePlain(pre).replace(/\n$/, "")) || ZWSP;
    pre.replaceWith(paragraph);
    placeCaret(paragraph, false);
    return;
  }
  const wrapper = document.createElement("pre");
  const code = document.createElement("code");
  const source = block && block !== root ? plainText(block.innerText.replace(/\n$/, "")) : "";
  code.textContent = source || "code";
  wrapper.append(code);
  if (block && block !== root) block.replaceWith(wrapper);
  else root.append(wrapper);
  if (!wrapper.nextElementSibling) wrapper.after(emptyParagraph());
  if (!source) {
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  } else {
    placeCaret(code, false);
  }
}

function applyLink(root: HTMLElement) {
  const selection = selectionIn(root);
  if (!selection || selection.rangeCount === 0) return;
  const anchor = selection.anchorNode;
  const parent = anchor instanceof Element ? anchor : anchor?.parentElement;
  const existing = parent?.closest("a");
  if (existing && root.contains(existing)) {
    existing.replaceWith(document.createTextNode(existing.textContent ?? ""));
    return;
  }
  const entered = window.prompt("Link address", "https://");
  if (entered == null) return;
  const href = safeUrl(entered);
  if (!href) return;
  if (selection.isCollapsed) {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.textContent = "link";
    selection.getRangeAt(0).insertNode(link);
    const range = document.createRange();
    range.selectNodeContents(link);
    selection.removeAllRanges();
    selection.addRange(range);
    return;
  }
  document.execCommand("createLink", false, href);
  root.querySelectorAll("a").forEach((link) => {
    if (!safeUrl(link.getAttribute("href") ?? "")) {
      link.replaceWith(document.createTextNode(link.textContent ?? ""));
      return;
    }
    link.target = "_blank";
    link.rel = "noreferrer noopener";
  });
}

function insertRule(root: HTMLElement) {
  const block = closestBlock(root);
  const rule = document.createElement("hr");
  const paragraph = document.createElement("p");
  paragraph.innerHTML = "<br>";
  if (block && block !== root && block.parentElement === root) block.after(rule, paragraph);
  else root.append(rule, paragraph);
  const range = document.createRange();
  range.setStart(paragraph, 0);
  range.collapse(true);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function toTaskItem(item: HTMLElement): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "task-item";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.tabIndex = -1;
  const existing = item.querySelector("input[type=checkbox]");
  if (existing instanceof HTMLInputElement && existing.checked) input.checked = true;
  input.setAttribute("aria-label", input.checked ? "Done" : "Not done");
  const span = document.createElement("span");
  const source = item.querySelector(":scope > span");
  if (source) span.innerHTML = source.innerHTML || "<br>";
  else {
    const clone = item.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("input, ul, ol").forEach((node) => node.remove());
    span.innerHTML = clone.innerHTML.trim() ? clone.innerHTML : "<br>";
  }
  li.append(input, span);
  return li;
}

function applyTask(root: HTMLElement) {
  const block = closestBlock(root);
  const item = block?.closest("li");
  const list = item?.parentElement;
  if (list && list.classList.contains("task") && root.contains(list)) {
    const fragment = document.createDocumentFragment();
    for (const child of [...list.children]) {
      if (!(child instanceof HTMLElement) || child.tagName !== "LI") continue;
      const paragraph = document.createElement("p");
      const span = child.querySelector(":scope > span");
      paragraph.innerHTML = span?.innerHTML?.trim() ? span.innerHTML : "<br>";
      if (!paragraph.textContent?.trim()) paragraph.innerHTML = "<br>";
      fragment.append(paragraph);
    }
    list.replaceWith(fragment);
    return;
  }
  if (list && root.contains(list) && (list.tagName === "UL" || list.tagName === "OL")) {
    const next = document.createElement("ul");
    next.className = "task";
    for (const child of [...list.children]) {
      if (child instanceof HTMLElement && child.tagName === "LI") next.append(toTaskItem(child));
    }
    list.replaceWith(next);
    return;
  }
  const next = document.createElement("ul");
  next.className = "task";
  const task = document.createElement("li");
  task.className = "task-item";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.tabIndex = -1;
  input.setAttribute("aria-label", "Not done");
  const span = document.createElement("span");
  if (block && block !== root && /^(P|DIV|H[1-6])$/.test(block.tagName)) {
    span.innerHTML = block.innerHTML.trim() ? block.innerHTML : "<br>";
    task.append(input, span);
    next.append(task);
    block.replaceWith(next);
    return;
  }
  span.innerHTML = "<br>";
  task.append(input, span);
  next.append(task);
  root.append(next);
}

export function insertWikiLink(root: HTMLElement, title: string) {
  const label = title.trim().replace(/[\[\]]/g, "");
  if (!label) return;
  root.focus();
  const selection = selectionIn(root);
  if (!selection || selection.rangeCount === 0) return;
  const anchor = document.createElement("a");
  anchor.className = "quire-wiki";
  anchor.href = "#";
  anchor.dataset.wiki = label;
  anchor.textContent = label;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(anchor);
  const space = document.createTextNode(" ");
  anchor.after(space);
  range.setStart(space, 1);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  settleEditor(root);
}

export function applyRichFormat(root: HTMLElement, id: FormatId) {
  root.focus();
  document.execCommand("defaultParagraphSeparator", false, "p");
  selectionIn(root);
  switch (id) {
    case "bold":
      document.execCommand("bold");
      break;
    case "italic":
      document.execCommand("italic");
      break;
    case "strike":
      document.execCommand("strikeThrough");
      break;
    case "h2":
      toggleHeading(root, "h2");
      break;
    case "h3":
      toggleHeading(root, "h3");
      break;
    case "bullet":
      document.execCommand("insertUnorderedList");
      break;
    case "number":
      document.execCommand("insertOrderedList");
      break;
    case "task":
      applyTask(root);
      break;
    case "quote":
      toggleQuote(root);
      break;
    case "code":
      applyInlineCode(root);
      break;
    case "codeblock":
      toggleCodeBlock(root);
      break;
    case "link":
      applyLink(root);
      break;
    case "rule":
      insertRule(root);
      break;
  }
  normalizeEditor(root);
  ensureWritableTail(root);
  settleEditor(root);
}

function prePlain(pre: HTMLElement): string {
  let text = "";
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += (node.textContent ?? "").replace(/\u00a0/g, " ");
      return;
    }
    if (node instanceof HTMLBRElement) {
      text += "\n";
      return;
    }
    node.childNodes.forEach(visit);
  };
  visit(pre);
  return text.replace(/\u200b/g, "");
}

function offsetInPre(pre: HTMLElement): number | null {
  const selection = document.getSelection();
  if (!selection || !selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (range.endContainer !== pre && !pre.contains(range.endContainer)) return null;
  let offset = 0;
  let found = false;
  const visit = (node: Node): boolean => {
    if (node === range.endContainer) {
      if (node.nodeType === Node.TEXT_NODE) offset += range.endOffset;
      else if (node instanceof HTMLElement) {
        const children = [...node.childNodes].slice(0, range.endOffset);
        children.forEach((child) => {
          if (child.nodeType === Node.TEXT_NODE) offset += child.textContent?.length ?? 0;
          else if (child instanceof HTMLBRElement) offset += 1;
          else offset += prePlain(child as HTMLElement).length;
        });
      }
      found = true;
      return true;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent?.length ?? 0;
      return false;
    }
    if (node instanceof HTMLBRElement) {
      offset += 1;
      return false;
    }
    for (const child of node.childNodes) {
      if (visit(child)) return true;
    }
    return false;
  };
  visit(pre);
  return found ? offset : null;
}

function setCodeText(pre: HTMLElement, text: string, caret: number) {
  const code = document.createElement("code");
  const needsAnchor = text.length === 0 || text.endsWith("\n");
  const stored = needsAnchor ? `${text}${ZWSP}` : text;
  code.textContent = stored;
  pre.replaceChildren(code);
  const node = code.firstChild ?? code.appendChild(document.createTextNode(""));
  const limit = needsAnchor ? text.length : (node.textContent?.length ?? 0);
  const point = Math.max(0, Math.min(caret, limit, node.textContent?.length ?? 0));
  const range = document.createRange();
  range.setStart(node, point);
  range.collapse(true);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function handleCodeEnter(root: HTMLElement): boolean {
  const pre = closestBlock(root)?.closest("pre");
  if (!pre || !root.contains(pre)) return false;
  const text = prePlain(pre);
  let offset = offsetInPre(pre);
  if (offset == null) return false;
  if (offset > text.length) offset = text.length;
  const before = text.slice(0, offset);
  const after = text.slice(offset);
  const line = before.slice(before.lastIndexOf("\n") + 1);
  if (after === "" && line === "" && before.endsWith("\n")) {
    setCodeText(pre, before.replace(/\n$/, "") + after, 0);
    const following = pre.nextElementSibling;
    const paragraph = following instanceof HTMLParagraphElement ? following : emptyParagraph();
    if (paragraph !== following) pre.after(paragraph);
    placeCaret(paragraph, true);
    return true;
  }
  const next = `${before}\n${after}`;
  setCodeText(pre, next, before.length + 1);
  return true;
}

export function exitEmptyListItem(root: HTMLElement): boolean {
  const item = closestBlock(root)?.closest("li");
  if (!item || !root.contains(item)) return false;
  if (liPlain(item)) return false;
  const list = item.parentElement;
  const paragraph = emptyParagraph();
  if (list && [...list.children].filter((child) => child.tagName === "LI").length <= 1) list.replaceWith(paragraph);
  else {
    item.remove();
    list?.after(paragraph);
  }
  placeCaret(paragraph, true);
  return true;
}
