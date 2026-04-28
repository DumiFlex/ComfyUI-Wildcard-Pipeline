/**
 * Wildcard syntax helpers.
 *
 * Pure utilities that inspect a wildcard module's option values and surface
 * syntactic features used by the manager UI (nested `@{uuid}` ref targets,
 * inline `{a|b|c}` choice blocks). Mirrors the React reference at
 * `docs/design-handoff/wildcardpipeline/project/data.jsx` so list-screen
 * rendering matches the prototype exactly.
 *
 * Graph is keyed by module UUID (mod.id) — the stable identifier emitted by
 * the tokenizer's `@{8hex}` ref syntax. `uuidToName` provides human-readable
 * labels for display.
 */
import type { ModuleRow, WildcardOption, WildcardPayload } from "../api/types";
import { tokenizeRich } from "./richTokenize";
import { toIdentifier } from "./slug";

export interface SyntaxFlags {
  /** Any option value contains an `@{uuid}` reference token. */
  hasRefs: boolean;
  /** Any option value contains an inline `{a|b|c}` choice block. */
  hasInline: boolean;
  /** Distinct UUID targets across every option value (deduped, ordered). */
  refTargets: string[];
}

/** Pull `@{8hex}` ref-token UUIDs out of a single value string via `tokenizeRich`. */
function refsInValue(value: string): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const tok of tokenizeRich(value)) {
    if (tok.kind === "ref" && tok.meta?.uuid) out.push(tok.meta.uuid);
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
  /** outgoing[uuid] = Set of UUIDs it references via `@{uuid}` refs. */
  outgoing: Map<string, Set<string>>;
  /** incoming[uuid] = Set of UUIDs that reference it. */
  incoming: Map<string, Set<string>>;
  /** Maps each wildcard UUID to its human-readable var_binding (or slug). */
  uuidToName: Map<string, string>;
}

/**
 * Build a bidirectional reference graph keyed by wildcard UUID (`mod.id`).
 * Edges are only added when the target UUID resolves to an actual wildcard in
 * the input list — dangling `@{uuid}` tokens are dropped so callers can rely
 * on `incoming.get(uuid)` returning known peers.
 *
 * `uuidToName` is populated from each wildcard's `var_binding` (or slug
 * fallback) and used for display purposes.
 */
export function buildWildcardGraph(modules: ModuleRow[]): WildcardGraph {
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  const uuidToName = new Map<string, string>();

  const wildcards = modules.filter((m) => m.type === "wildcard");
  const knownUuids = new Set<string>();

  for (const w of wildcards) {
    knownUuids.add(w.id);
    uuidToName.set(w.id, wildcardVarName(w));
  }

  for (const w of wildcards) {
    const srcUuid = w.id;
    const out = new Set<string>();
    outgoing.set(srcUuid, out);

    for (const targetUuid of getWildcardSyntax(w).refTargets) {
      if (!knownUuids.has(targetUuid)) continue;
      out.add(targetUuid);
      let inSet = incoming.get(targetUuid);
      if (!inSet) {
        inSet = new Set<string>();
        incoming.set(targetUuid, inSet);
      }
      inSet.add(srcUuid);
    }
  }

  // Ensure every wildcard appears as a key in both maps for easy lookup.
  for (const uuid of knownUuids) {
    if (!outgoing.has(uuid)) outgoing.set(uuid, new Set());
    if (!incoming.has(uuid)) incoming.set(uuid, new Set());
  }

  return { outgoing, incoming, uuidToName };
}
