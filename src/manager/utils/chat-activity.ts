/**
 * The work behind a chat answer, folded the way DeepSeek Harness, Claude and
 * ChatGPT fold it (`/pr-drafts/ai-chat-activity-display-2026-11-25.md`):
 *
 *   - the whole answer's work sits under one "Worked for 1m 12s" line;
 *   - the work between two things the model said is ONE group, titled by
 *     what it did ("Read 3 items and searched the docs") or, while it runs,
 *     by what it is doing now ("Reading Hair Color");
 *   - what the model said between steps stays visible between the groups;
 *   - a retry or fallback the server made is its own muted row.
 *
 * Pure: the drawer (`AiActivity.vue`) draws what these return.
 */
import type { AiChatStep } from "../api/types";
import { tookLabel } from "./chat-took";

export type ActivityCat = "read" | "search" | "docs" | "web" | "test" | "change" | "page" | "other";

const CATS: Record<string, ActivityCat> = {
  read: "read", variables: "read", explain: "read",
  search: "search", lookup: "search", find_duplicates: "search",
  docs_search: "docs", docs_read: "docs",
  web_search: "web", read_result: "web", danbooru: "web",
  run_test: "test",
  open: "page", read_page: "page", highlight: "page", select_rows: "page",
  organize: "page", draft_options: "page", show_test: "page", use_panel: "page",
};

/** What kind of work a tool is, for the group titles and icons. */
export function categoryOf(tool: string): ActivityCat {
  const c = CATS[tool];
  if (c) return c;
  if (/^(create|edit|add|update|delete)_/.test(tool) || tool === "plan_pack") return "change";
  return "other";
}

/** A PrimeIcons name per kind, shown on a group's header. */
export const CAT_ICON: Record<ActivityCat | "think", string> = {
  think: "pi-lightbulb", read: "pi-book", search: "pi-search", docs: "pi-question-circle",
  web: "pi-globe", test: "pi-play", change: "pi-pencil", page: "pi-window-maximize",
  other: "pi-cog",
};

export type ActivityItem =
  | { kind: "group"; key: string; steps: AiChatStep[];
      /** ms since the answer started: where it began and ended, when known. */
      from?: number; to?: number }
  | { kind: "say"; key: string; step: AiChatStep }
  | { kind: "notice"; key: string; step: AiChatStep };

/** The steps as groups, things said and notices, in order. A group's key is
 *  its first step's index, so it stays the same while the answer streams
 *  more steps into it. `said` (the final reply) is left out when a "say"
 *  step repeats it. */
export function groupSteps(steps: readonly AiChatStep[], said = ""): ActivityItem[] {
  const out: ActivityItem[] = [];
  let group: Extract<ActivityItem, { kind: "group" }> | null = null;
  let lastAt: number | undefined = 0;
  steps.forEach((s, i) => {
    if (s.say || s.notice) {
      group = null;
      if (s.say && said && s.note.trim() === said.trim()) return;
      out.push({ kind: s.say ? "say" : "notice", key: `${s.say ? "s" : "n"}${i}`, step: s });
      if (s.at !== undefined) lastAt = s.at;
      return;
    }
    if (!group) {
      group = { kind: "group", key: `g${i}`, steps: [], ...(lastAt !== undefined ? { from: lastAt } : {}) };
      out.push(group);
    }
    group.steps.push(s);
    if (s.at !== undefined) { group.to = s.at; lastAt = s.at; }
  });
  return out;
}

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** How each kind reads once done, with its count. */
const DONE: Record<ActivityCat, (n: number) => string> = {
  read: (n) => `read ${count(n, "item")}`,
  search: (n) => `searched ${n === 1 ? "once" : `${n} times`}`,
  docs: (n) => `read ${count(n, "docs page")}`,
  web: (n) => `looked at ${count(n, "web result")}`,
  test: (n) => `ran ${count(n, "test")}`,
  change: (n) => `drafted ${count(n, "change")}`,
  page: (n) => count(n, "page action"),
  other: (n) => count(n, "other step"),
};

/** Tool steps by kind, in the order each kind first came up. */
export function tally(steps: readonly AiChatStep[]): Array<[ActivityCat, number]> {
  const m = new Map<ActivityCat, number>();
  for (const s of steps) {
    if (s.think || s.say || s.notice) continue;
    const c = categoryOf(s.tool);
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  return [...m.entries()];
}

function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length > 3) return `${parts.slice(0, 3).join(", ")} and more`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A finished group's title: "Read 3 items and searched the docs", or
 *  "Thought it through" when it only thought. */
export function doneTitle(steps: readonly AiChatStep[]): string {
  const parts = tally(steps).map(([c, n]) => DONE[c](n));
  return parts.length ? cap(joinParts(parts)) : "Thought it through";
}

/** The kind most of a group's work was, for its icon. */
export function mainCat(steps: readonly AiChatStep[]): ActivityCat | "think" {
  const t = tally(steps);
  if (!t.length) return "think";
  return t.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

/** Calls in the group that failed. */
export function failedCount(steps: readonly AiChatStep[]): number {
  return steps.filter((s) => !s.ok && !s.think && !s.say && !s.notice).length;
}

/** The last finished line of reasoning, short, for a one-line preview
 *  ("checking which variables Hair Color sets"). An unfinished last line
 *  is left out while `streaming`, so the preview doesn't jitter. */
export function previewLine(text: string, streaming = false, max = 90): string {
  const lines = text.split("\n");
  if (streaming) lines.pop();
  const last = [...lines].reverse().map((l) => l.replace(/^[\s#>*\-\d.)]+/, "").trim()).find(Boolean) ?? "";
  return last.length > max ? `${last.slice(0, max - 1).trimEnd()}…` : last;
}

/** "4 s", "1 min 5 s": how long a group took, or "" when unknown. */
export function groupTime(item: Extract<ActivityItem, { kind: "group" }>): string {
  if (item.from === undefined || item.to === undefined || item.to < item.from) return "";
  return tookLabel(item.to - item.from);
}

/** The answer's one-line header: "Worked for 1 min 12 s" and what it did
 *  in short ("read 4 items, ran 1 test"). */
export function turnSummary(steps: readonly AiChatStep[], elapsedMs?: number): { title: string; detail: string } {
  const took = tookLabel(elapsedMs);
  const parts = tally(steps).map(([c, n]) => DONE[c](n));
  const thought = steps.some((s) => s.think);
  return {
    title: took ? `Worked for ${took}` : "Worked",
    detail: parts.length ? joinParts(parts) : thought ? "thought it through" : "",
  };
}

/** Whether an answer has work to fold (anything besides what it said). */
export function hasWork(steps: readonly AiChatStep[]): boolean {
  return steps.some((s) => !s.say);
}
