/**
 * Turns a Cleaner run's trace + report into one row per rule for the Last run
 * window: the text before and after that rule, a plain line saying what it
 * did, and why: for each tag a dedupe, fuzzy dedupe or blocklist dropped, the
 * tag it repeats, the tag it is close to or the entry it matched, plus where
 * that cause sits in the text (marked in the diff).
 */
import type { DiffMark } from "@/kit/diff";
import type { CleanerTrace, NegativeRunReport, RunReport, StepRule } from "./types";

export const RULE_LABELS: Record<StepRule, string> = {
  empty_groups: "empty groups",
  merge_weights: "merge weights",
  lora_spacing: "LoRA spacing",
  whitespace: "whitespace",
  punctuation: "punctuation",
  dedupe_exact: "tag dedupe",
  fuzzy_dedupe: "fuzzy dedupe",
  blocklist: "blocklist",
  prompt_overlap: "also in prompt",
};

export interface RuleReason {
  item: string;
  /** "repeats", "is 90% like", "matched", "is also in". */
  verb: string;
  cause: string;
}

export interface RuleStep {
  rule: StepRule;
  before: string;
  after: string;
  changed: boolean;
  summary: string;
  /** Tags or entries the rule dropped, when it lists them. */
  items: string[];
  /** Regex entries that didn't compile (blocklist). */
  errors: string[];
  /** Why each dropped item went. */
  reasons: RuleReason[];
  /** Where those causes sit in `before`, for the diff's marks. */
  marks: DiffMark[];
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function count(v: unknown): number {
  if (typeof v === "number") return v;
  return Array.isArray(v) ? v.length : 0;
}
function n(k: number, one: string, many = `${one}s`): string {
  return `${k} ${k === 1 ? one : many}`;
}

function summarize(rule: StepRule, stats: Record<string, unknown>): string {
  switch (rule) {
    case "whitespace": return `fixed ${n(count(stats.fixed), "spacing or comma slip")}`;
    case "punctuation": return `trimmed ${n(count(stats.stripped), "stray punctuation mark")}`;
    case "empty_groups": return `removed ${n(count(stats.removed), "empty bracket group")}`;
    case "merge_weights": return `merged ${n(count(stats.merged), "nested weight")}`;
    case "lora_spacing": return `tidied ${n(count(stats.tidied), "LoRA tag")}`;
    case "dedupe_exact": return `dropped ${n(count(stats.dropped), "repeated tag")}`;
    case "fuzzy_dedupe": return `dropped ${n(count(stats.dropped), "near-duplicate tag")}`;
    case "blocklist": return `dropped ${n(count(stats.dropped), "blocked tag")}`;
    case "prompt_overlap": return `dropped ${n(count(stats.tags), "tag")} the prompt also has`;
  }
}

/** Each comma-separated tag's trimmed span in `text`. */
export function tagSpans(text: string): { start: number; end: number; tag: string }[] {
  const out: { start: number; end: number; tag: string }[] = [];
  for (const m of text.matchAll(/[^,]+/g)) {
    const raw = m[0];
    const tag = raw.trim();
    if (!tag) continue;
    const start = (m.index ?? 0) + raw.length - raw.trimStart().length;
    out.push({ start, end: start + tag.length, tag });
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Where blocklist `entry` hits inside `span` of `text`: as a regex first
 *  (regex lists), else as a plain case-insensitive word or substring. */
export function entryHit(
  text: string,
  span: { start: number; end: number },
  entry: string,
): { start: number; end: number } | null {
  const inside = text.slice(span.start, span.end);
  for (const src of [entry, `\\b${escapeRe(entry)}\\b`, escapeRe(entry)]) {
    let re: RegExp;
    try { re = new RegExp(src, "i"); } catch { continue; }
    const m = re.exec(inside);
    if (m && m[0]) return { start: span.start + m.index, end: span.start + m.index + m[0].length };
  }
  return null;
}

function explain(rule: StepRule, stats: Record<string, unknown>, before: string): Pick<RuleStep, "reasons" | "marks"> {
  const reasons: RuleReason[] = [];
  const marks: DiffMark[] = [];
  if (rule === "prompt_overlap") {
    for (const t of strings(stats.tags)) reasons.push({ item: t, verb: "is also in", cause: "the prompt" });
    return { reasons, marks };
  }
  const dropped = strings(stats.dropped);
  const matched = strings(stats.matched);
  if (!matched.length) return { reasons, marks };
  const scores = Array.isArray(stats.scores) ? stats.scores : [];
  // Fuzzy dedupe says why each drop went: "form" (same words once
  // singular, `knight` / `knights`) or "close" (the similarity score).
  const kinds = strings(stats.kinds);
  const spans = tagSpans(before);
  const usedDrops = new Set<number>();
  dropped.forEach((item, i) => {
    const cause = matched[i];
    if (cause === undefined) return;
    if (rule === "blocklist") {
      reasons.push({ item, verb: "matched", cause });
      const at = spans.findIndex((s, k) => !usedDrops.has(k) && s.tag === item);
      const span = spans[at];
      if (!span) return;
      usedDrops.add(at);
      const hit = entryHit(before, span, cause);
      if (hit) marks.push({ ...hit, label: `blocklist entry "${cause}"` });
      return;
    }
    const raw: unknown = scores[i];
    const score = typeof raw === "number" ? Math.round(raw * 100) : null;
    const verb = rule !== "fuzzy_dedupe" ? "repeats"
      : kinds[i] === "form" ? "is another form of"
      : score !== null && score < 100 ? `is ${score}% like` : "repeats";
    reasons.push({ item, verb, cause });
    const kept = spans.find((s) => s.tag === cause);
    if (kept && !marks.some((m) => m.start === kept.start)) {
      marks.push({ start: kept.start, end: kept.end, label: `kept: "${item}" ${verb} it` });
    }
  });
  return { reasons, marks };
}

/** One row per trace step, in run order. */
export function ruleSteps(trace: CleanerTrace, report: RunReport | NegativeRunReport | null): RuleStep[] {
  const out: RuleStep[] = [];
  let text = trace.input;
  for (const s of trace.steps) {
    const after = s.text ?? text;
    const stats = ((report as Record<string, unknown> | null)?.[s.rule] ?? {}) as Record<string, unknown>;
    const changed = after !== text;
    out.push({
      rule: s.rule,
      before: text,
      after,
      changed,
      summary: changed ? summarize(s.rule, stats) : "no change",
      items: strings(stats.dropped),
      errors: strings(stats.errors),
      ...(changed ? explain(s.rule, stats, text) : { reasons: [], marks: [] }),
    });
    text = after;
  }
  return out;
}
