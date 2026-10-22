/**
 * What the AI chat boxes complete, and what a completion inserts.
 *
 * Pure (no DOM, no fetch) so the probe + insert rules are unit-tested; the
 * popover itself is `components/ai/ChatCompletions.vue`. Research and the
 * reasoning behind each choice: /pr-drafts/editor-polish.md.
 *
 * - `@word`  → a library item (any module kind or a bundle). The box shows
 *   `@Name`; the item's id is remembered, and `withMentionIds` turns it into
 *   `[[id#Name]]` (the mention form the chat writes in its own answers) when
 *   the message is sent, so the model gets the exact id and the server can
 *   hand it the item's facts (`engine/ai/index.py::mentioned`) without a
 *   search. The raw `[[id#Name]]` in the box read as noise.
 * - `$word`  → a variable some library item writes. Inserts `$name`.
 * - `<lora:` / `embedding:` → that kind of model file. Inserts its path.
 * - a bare word (3+ letters) → booru tags, LoRAs and embeddings, when those
 *   completion sources are switched on (the same settings as the editors).
 */
import { probeAutocomplete, probeModelRef, probeTagWord } from "./autocompleteProbe";
import type { ModelKind, ModelSuggestion, TagSuggestion } from "../api/types";

/** A library item the `@` menu can offer. */
export interface MentionItem {
  id: string;
  name: string;
  /** Module type (`wildcard`, `combine`, …) or `bundle`. */
  kind: string;
  /** The variable it writes, when it writes one. Shown and searched. */
  variable?: string;
}

/** Every module and bundle as `@` menu items (and mention-chip lookups). */
export function mentionItems(
  modules: readonly { id: string; name: string; type: string; payload?: unknown }[],
  bundles: readonly { id: string; name: string }[],
): MentionItem[] {
  return [
    ...modules.map((m) => {
      const p = (m.payload ?? {}) as { var_binding?: string; output_var?: string };
      const variable = (p.var_binding || p.output_var || "").replace(/^\$+/, "").trim();
      return { id: m.id, name: m.name, kind: m.type, ...(variable ? { variable } : {}) };
    }),
    ...bundles.map((b) => ({ id: b.id, name: b.name, kind: "bundle" })),
  ];
}

/** A variable the `$` menu can offer, with what writes it. */
export interface VarItem {
  name: string;
  kind: string;
}

export type ChatProbe =
  | { mode: "item"; start: number; query: string }
  | { mode: "var"; start: number; query: string }
  | { mode: "model"; start: number; query: string; kind: ModelKind }
  | { mode: "word"; start: number; query: string };

/** What the caret is completing, if anything. Model references first (their
 *  names hold dots and spaces no other probe can bound), then `@` / `$`,
 *  then a bare word. */
export function probeChat(text: string, caret: number): ChatProbe | null {
  const model = probeModelRef(text, caret);
  if (model) return { mode: "model", start: model.start, query: model.query, kind: model.kind };
  const sigil = probeAutocomplete(text, caret);
  if (sigil) {
    // Past a dot is an accessor (`$outfit.SHOES`): the chat box has nothing to
    // offer there, so stay closed rather than matching the axis as a name.
    if (sigil.query.includes(".")) return null;
    return { mode: sigil.trigger === "@" ? "item" : "var", start: sigil.start, query: sigil.query };
  }
  const word = probeTagWord(text, caret);
  if (word) return { mode: "word", start: word.start, query: word.query };
  return null;
}

function rank(name: string, q: string): number {
  const n = name.toLowerCase();
  if (!q) return 2;
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.split(/[\s_\-/]+/).some((w) => w.startsWith(q))) return 2;
  return n.includes(q) ? 3 : -1;
}

/** Library items for an `@query`, best match first. Matches the name or the
 *  variable, so `@hair` finds a wildcard named "Hairstyle" or writing $hair. */
export function matchItems(items: readonly MentionItem[], query: string, limit = 8): MentionItem[] {
  const q = query.toLowerCase().replace(/_/g, " ");
  const qv = query.toLowerCase();
  const scored: Array<{ item: MentionItem; r: number }> = [];
  for (const item of items) {
    const byName = rank(item.name.replace(/_/g, " "), q);
    const byVar = item.variable ? rank(item.variable, qv) : -1;
    const r = [byName, byVar].filter((x) => x >= 0).reduce((a, b) => Math.min(a, b), 99);
    if (r < 99) scored.push({ item, r });
  }
  scored.sort((a, b) => a.r - b.r || a.item.name.localeCompare(b.item.name));
  return scored.slice(0, limit).map((s) => s.item);
}

export function matchVars(vars: readonly VarItem[], query: string, limit = 8): VarItem[] {
  const q = query.toLowerCase();
  return vars
    .map((v) => ({ v, r: rank(v.name, q) }))
    .filter((e) => e.r >= 0)
    .sort((a, b) => a.r - b.r || a.v.name.localeCompare(b.v.name))
    .slice(0, limit)
    .map((e) => e.v);
}

/** One popover row. */
export type ChatRow =
  | { source: "item"; item: MentionItem }
  | { source: "var"; v: VarItem }
  | { source: "tag"; tag: TagSuggestion }
  | { source: "lora" | "embedding"; model: ModelSuggestion };

/** Square brackets would end the mention early; a name never needs them. */
function mentionName(name: string): string {
  return name.replace(/[[\]]/g, "").trim();
}

/** What the box shows for a picked item. */
export function mentionLabel(name: string): string {
  return `@${mentionName(name)}`;
}

/** Labels picked from the `@` menu this session, to the mention each sends
 *  as. Module-level: a message put back in a box (an edit, a failed send)
 *  turns into labels again and finds its ids here. */
const picked = new Map<string, string>();

/** Remember a picked item; returns the label the box shows. */
export function rememberMention(item: { id: string; name: string }): string {
  const label = mentionLabel(item.name);
  picked.set(label, `[[${item.id}#${mentionName(item.name)}]]`);
  return label;
}

function labelPattern(): RegExp | null {
  if (!picked.size) return null;
  // Longest first, so "@Hair style" wins over "@Hair".
  const alts = [...picked.keys()].sort((a, b) => b.length - a.length)
    .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\w@])(?:${alts.join("|")})(?![\\w])`, "g");
}

/** The text to send: each picked `@Name` as its `[[id#Name]]` mention.
 *  A label the user typed by hand, or edited, goes as written. */
export function withMentionIds(text: string): string {
  const re = labelPattern();
  return re ? text.replace(re, (l) => picked.get(l) ?? l) : text;
}

/** The other way, for a sent message put back into a box: `[[id#Name]]`
 *  shows as `@Name` again (and sends as the same mention). */
export function withMentionLabels(text: string): string {
  return text.replace(/\[\[([0-9a-f]{8})#([^[\]\n]+)\]\]/g, (_m, id: string, name: string) =>
    rememberMention({ id, name }));
}

/** Text with each mention or ref shown by its name, for places that draw
 *  plain text (a saved chat's title). */
export function plainMentions(text: string): string {
  return text.replace(/\[\[[0-9a-f]{8}#([^[\]\n]+)\]\]|@\{[0-9a-f]{8}#([^}:!\n]+)[^}\n]*\}/g,
    (_m, a: string | undefined, b: string | undefined) => a ?? b ?? "");
}

/** Test seam. */
export function _resetMentionsForTests(): void {
  picked.clear();
}

/** What a picked row puts in the box (without any trailing separator). */
export function rowText(row: ChatRow, probe: ChatProbe): string {
  switch (row.source) {
    case "item": return mentionLabel(row.item.name);
    case "var": return `$${row.v.name}`;
    case "tag": return row.tag.name;
    default:
      // Inside a reference the marker is already typed: insert the path only.
      if (probe.mode === "model") return row.model.path;
      return row.source === "lora" ? `<lora:${row.model.path}:1.0>` : `embedding:${row.model.path}`;
  }
}

/** The box text after picking `row`, and where the caret goes. Replaces the
 *  trigger and the typed query (the `@` / `$` too: the inserted text carries
 *  its own sigil), then adds `suffix` and one space before following text. */
export function applyRow(
  text: string,
  caret: number,
  probe: ChatProbe,
  row: ChatRow,
  suffix = "",
): { text: string; caret: number; from: number; to: number; insert: string } {
  const from = probe.start;
  // Swallow the rest of the word the caret sits in, so picking with the
  // caret mid-word does not leave its tail glued to the insert.
  let to = caret;
  if (probe.mode !== "model") {
    while (to < text.length && /[A-Za-z0-9_]/.test(text[to])) to++;
  }
  const after = text.slice(to);
  const body = rowText(row, probe) + suffix;
  const space = probe.mode === "model" || /^\s/.test(after) || suffix.endsWith(" ") ? "" : " ";
  const insert = body + space;
  const next = text.slice(0, from) + insert + after;
  return { text: next, caret: from + insert.length, from, to, insert };
}

/** `[[id#Name]]` labels in a message the user wrote, mapped to the library
 *  items they name, in the `refs` shape `AiMessage` draws chips from. So the
 *  user's own bubble shows the picked items as chips that open them. */
export function mentionRefs(
  text: string,
  items: readonly MentionItem[],
): Record<string, { id: string; type: string; name: string }> {
  const out: Record<string, { id: string; type: string; name: string }> = {};
  for (const m of text.matchAll(/\[\[([0-9a-f]{8})(?:#([^[\]\n]*))?\]\]/g)) {
    const item = items.find((i) => i.id === m[1]);
    if (item) out[m[0].slice(2, -2)] = { id: item.id, type: item.kind, name: item.name };
  }
  return out;
}
