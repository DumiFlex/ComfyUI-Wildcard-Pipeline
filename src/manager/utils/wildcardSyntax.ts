/**
 * Wildcard syntax helpers.
 *
 * Pure utilities that inspect a wildcard module's option values and surface
 * syntactic features used by the manager UI (nested `@{uuid}` ref targets,
 * inline `{a|b|c}` choice blocks). Mirrors the React reference at
 * `docs/design-handoff/wildcardpipeline/project/data.jsx` so list-screen
 * rendering matches the prototype exactly.
 *
 * Graph is keyed by the 8-hex short UUID — the SUFFIX of `mod.id` (e.g.
 * `wc_outfit_ea67b173` → `ea67b173`). This is the same identifier the
 * tokenizer's `@{8hex}` ref token captures into `meta.uuid`, and the same
 * key WildcardEditor uses for `nameByUuid`. Keying by the full `mod.id`
 * would miss every ref edge because targetUuid never matches the slugged
 * source id.
 */
import type { ModuleRow, WildcardOption, WildcardPayload } from "../api/types";
import { tokenizeRich } from "./richTokenize";
import { extractModuleUuid, toIdentifier } from "./slug";

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

/**
 * Build the canonical 8-hex UUID → display-name map every consumer of
 * `@{uuid}` ref tokens needs (RichTextInput, RichTextPreview, autocomplete).
 *
 * Standalone helper rather than only `buildWildcardGraph().uuidToName` so
 * callers that just need labels (TestRunner histogram, Combine preview, …)
 * don't pay the cost of walking option values to build edge sets.
 */
export function buildUuidToName(modules: ModuleRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of modules) {
    if (m.type !== "wildcard") continue;
    const uuid = extractModuleUuid(m.id);
    if (!uuid) continue;
    out.set(uuid, wildcardVarName(m));
  }
  return out;
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
  // Pair each wildcard with its 8-hex short UUID (extracted from the slug).
  // Modules with non-standard ids (legacy imports, fixtures) are skipped —
  // they can't be referenced via `@{8hex}` anyway.
  const pairs: Array<{ mod: ModuleRow; uuid: string }> = [];
  const knownUuids = new Set<string>();

  for (const w of wildcards) {
    const uuid = extractModuleUuid(w.id);
    if (!uuid) continue;
    pairs.push({ mod: w, uuid });
    knownUuids.add(uuid);
    uuidToName.set(uuid, wildcardVarName(w));
  }

  for (const { mod, uuid: srcUuid } of pairs) {
    const out = new Set<string>();
    outgoing.set(srcUuid, out);

    for (const targetUuid of getWildcardSyntax(mod).refTargets) {
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
