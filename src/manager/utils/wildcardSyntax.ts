/**
 * Wildcard syntax helpers.
 *
 * Pure utilities that inspect a wildcard module's option values and surface
 * syntactic features used by the manager UI (nested `@ref` targets, inline
 * `{a|b|c}` choice blocks). Mirrors the React reference at
 * `docs/design-handoff/wildcardpipeline/project/data.jsx` so list-screen
 * rendering matches the prototype exactly.
 */
import type { ModuleRow, WildcardOption, WildcardPayload } from "../api/types";
import { tokenizeRich } from "./richTokenize";
import { toIdentifier } from "./slug";

export interface SyntaxFlags {
  /** Any option value contains an `@name` reference token. */
  hasRefs: boolean;
  /** Any option value contains an inline `{a|b|c}` choice block. */
  hasInline: boolean;
  /** Distinct `@name` targets across every option value (deduped, ordered). */
  refTargets: string[];
}

/** Pull `@name` ref-token names out of a single value string via `tokenizeRich`. */
function refsInValue(value: string): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const tok of tokenizeRich(value)) {
    if (tok.kind === "ref" && tok.meta?.name) out.push(tok.meta.name);
  }
  return out;
}

/** Detect a `{a|b|c}` block — at least one `|` between the braces. */
function hasInlineChoice(value: string): boolean {
  if (!value) return false;
  for (const tok of tokenizeRich(value)) {
    // `dp-brace` tokens are only emitted for genuine multi-branch `{a|b|c}`
    // blocks (single-branch falls back to literal text), so their presence
    // guarantees a real alternation rather than a stray `|`.
    if (tok.kind === "dp-brace" || tok.kind === "dp-multi") {
      return true;
    }
  }
  return false;
}

/** Pull the option list out of a wildcard module's payload, defensively. */
function optionsOf(mod: ModuleRow): WildcardOption[] {
  const payload = mod.payload as unknown as Partial<WildcardPayload> | undefined;
  return payload?.options ?? [];
}

/**
 * The `$varname` other modules use to reference this wildcard. Falls back to
 * `toIdentifier(name)` for legacy modules saved before `var_binding` existed.
 */
export function wildcardVarName(mod: ModuleRow): string {
  const payload = mod.payload as unknown as Partial<WildcardPayload> | undefined;
  const explicit = payload?.var_binding?.trim();
  return explicit && explicit.length > 0 ? explicit : toIdentifier(mod.name);
}

/** Aggregate ref + inline-choice flags for a single wildcard module. */
export function getWildcardSyntax(mod: ModuleRow): SyntaxFlags {
  const refs = new Set<string>();
  let hasInline = false;
  for (const opt of optionsOf(mod)) {
    for (const r of refsInValue(opt.value)) refs.add(r);
    if (!hasInline && hasInlineChoice(opt.value)) hasInline = true;
  }
  return {
    hasRefs: refs.size > 0,
    hasInline,
    refTargets: [...refs],
  };
}

export interface WildcardGraph {
  /** outgoing[wcName] = Set of var-names it references via `@ref`. */
  outgoing: Map<string, Set<string>>;
  /** incoming[wcName] = Set of var-names that reference it. */
  incoming: Map<string, Set<string>>;
}

/**
 * Build a bidirectional reference graph keyed by wildcard `var_binding`
 * (or slug-fallback). Edges are only added when the target var-name resolves
 * to an actual wildcard in the input list — dangling `@ref` tokens are
 * dropped so callers can rely on `incoming.get(name)` returning known peers.
 */
export function buildWildcardGraph(modules: ModuleRow[]): WildcardGraph {
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();

  const wildcards = modules.filter((m) => m.type === "wildcard");
  const known = new Set<string>();
  const nameOf = new Map<string, string>();
  for (const w of wildcards) {
    const n = wildcardVarName(w);
    known.add(n);
    nameOf.set(w.id, n);
  }

  for (const w of wildcards) {
    const src = nameOf.get(w.id)!;
    const out = new Set<string>();
    outgoing.set(src, out);
    for (const target of getWildcardSyntax(w).refTargets) {
      if (!known.has(target)) continue;
      out.add(target);
      let inSet = incoming.get(target);
      if (!inSet) {
        inSet = new Set<string>();
        incoming.set(target, inSet);
      }
      inSet.add(src);
    }
  }

  // Ensure every wildcard appears as a key in both maps for easy lookup.
  for (const n of known) {
    if (!outgoing.has(n)) outgoing.set(n, new Set());
    if (!incoming.has(n)) incoming.set(n, new Set());
  }

  return { outgoing, incoming };
}
