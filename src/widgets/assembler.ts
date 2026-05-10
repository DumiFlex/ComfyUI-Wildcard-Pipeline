import { defineAsyncComponent, h, ref, type Component } from "vue";
import { app } from "#comfyui/app";
import { createDomWidgetHost, type MountTargetNode } from "./_shared";
import { attachThemeDetector } from "../extension/theme-detector";
import {
  collectUpstreamChain,
  collectUpstreamInjectorBindings,
  collectUpstreamResolved,
  findRootGraph,
  type LiteGraphLike,
  type LiteNodeLike,
} from "../extension/graph";
import { reactiveFromGraph } from "../extension/reactive";

const PREVIEW_SEED = 42;

const AssemblerHelper = defineAsyncComponent(() => import("../components/assembler/AssemblerHelper.vue"));

interface AssemblerNode extends LiteNodeLike, MountTargetNode {
  widgets?: { name: string; value: unknown }[];
}

function templateOf(node: AssemblerNode): string {
  const w = node.widgets?.find((x) => x.name === "template");
  return typeof w?.value === "string" ? w.value : "";
}

interface UpstreamSnapshot {
  /** Stable hash of the chain JSON — used to drive the API-backed
   *  preview fetch only when the upstream state actually shifts. */
  chainKey: string;
  /** Cached chain payload — POSTed to the preview endpoint. Kept so
   *  the fetch trigger and the fetch body share a single source of
   *  truth; the snapshot recomputes whenever the host graph changes. */
  chain: unknown[][];
  /** Sync fallback: client-side option-[0] resolution. Shown until
   *  the API resolves OR when the API is unreachable. */
  fallbackResolved: Record<string, string>;
  /** Bindings contributed by upstream WP_ContextInjector nodes. The
   *  preview API doesn't simulate injectors — these keys must come
   *  from the static fallback even when api results are available,
   *  otherwise injector overrides silently render the SHADOWED
   *  upstream value. */
  injectorKeys: string[];
  template: string;
}

function snapshotEqual(a: UpstreamSnapshot, b: UpstreamSnapshot): boolean {
  if (a.template !== b.template) return false;
  if (a.chainKey !== b.chainKey) return false;
  // Injector bindings live in `fallbackResolved` only — the API
  // resolver only knows WP_Context modules, so `chainKey` misses
  // changes to injector rows. Diff the resolved map keys + values so
  // injector binding/enabled/internal edits trigger a re-render.
  const ak = Object.keys(a.fallbackResolved);
  if (ak.length !== Object.keys(b.fallbackResolved).length) return false;
  for (const k of ak) if (a.fallbackResolved[k] !== b.fallbackResolved[k]) return false;
  if (a.injectorKeys.length !== b.injectorKeys.length) return false;
  for (let i = 0; i < a.injectorKeys.length; i++) {
    if (a.injectorKeys[i] !== b.injectorKeys[i]) return false;
  }
  return true;
}

/**
 * Engine-relevant subset of a `ModuleEntry`. Whitelist (not
 * blacklist) so accidentally-added UI fields don't silently bust
 * the preview cache:
 *
 *   - id, type, enabled — module identity + skip flag
 *   - payload, entries  — what handlers actually read
 *   - meta.name         — surfaces in the wildcard catalog name
 *   - instance.{relevant subset} — overrides the handlers consume
 *
 * Excluded (and the reasons):
 *   - collapsed              UI state
 *   - meta.description/tags  display only
 *   - payload_hash           drift detection, not resolution
 *   - instance.last_locked_seed
 *                            UI persistence — survives toggle-offs
 *                            so the modal can restore the user's
 *                            last seed, but doesn't affect what the
 *                            handler picks.
 *
 * Used for BOTH the chain hash (cache key) and the preview API
 * body so edits to fields the engine ignores never trigger a
 * preview refetch.
 */
const RELEVANT_INSTANCE_KEYS = new Set([
  "variable_binding",
  "enabled_options",
  "option_weights",
  "category_filter",
  "mode",
  "pinned_option_id",
  "locked_seed",
  "internal",
  // combine v2 (2026-05-08 syntax-parity cycle):
  "template_override",
  // fixed_values:
  "values_overrides",
  // Tier 2:
  "disabled_rule_ids",
  "disabled_exception_keys",
  "disabled_matrix_cells",
]);

/** Test-only export. Allows whitelist invariants to be asserted without
 *  re-stringifying the chain. NOT used by production code path. */
export const RELEVANT_INSTANCE_KEYS_FOR_TEST = RELEVANT_INSTANCE_KEYS;

function relevantModule(m: unknown): unknown {
  if (!m || typeof m !== "object") return m;
  const src = m as Record<string, unknown>;
  const out: Record<string, unknown> = {
    id: src.id,
    type: src.type,
    enabled: src.enabled,
  };
  if (src.payload !== undefined) out.payload = src.payload;
  if (src.entries !== undefined) out.entries = src.entries;
  if (src.meta && typeof src.meta === "object") {
    const meta = src.meta as Record<string, unknown>;
    if (meta.name !== undefined) out.meta = { name: meta.name };
  }
  if (src.instance && typeof src.instance === "object") {
    const inst = src.instance as Record<string, unknown>;
    const trimmed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(inst)) {
      if (RELEVANT_INSTANCE_KEYS.has(k) && v !== undefined && v !== null) {
        trimmed[k] = v;
      }
    }
    if (Object.keys(trimmed).length > 0) out.instance = trimmed;
  }
  return out;
}

function relevantChain(chain: unknown[][]): unknown[][] {
  return chain.map((step) => step.map(relevantModule));
}

/** Shallow string-map equality. Vue's ref reactivity triggers on
 *  every assignment to `.value`; reassigning to a structurally
 *  identical object still re-renders. Gating writes through this
 *  comparator avoids spurious re-renders when two distinct chains
 *  resolve to the same map (e.g. last_locked_seed-only edits). */
function shallowEqualResolved(
  a: Record<string, string> | null,
  b: Record<string, string>,
): boolean {
  if (a === null) return false;
  if (a === b) return true;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

/** Tiny FNV-1a-ish digest over the JSON-stringified chain. Not
 *  cryptographic — just a fast change detector so we don't refetch
 *  the preview on every 400ms tick when nothing's actually changed.
 *  Length-prefixed to disambiguate `[]` from `[[]]`. Pre-trimmed to
 *  the engine-relevant whitelist so renames/description edits/etc.
 *  never bust the cache. */
function hashChain(chain: unknown[][]): string {
  const stripped = relevantChain(chain);
  const s = JSON.stringify(stripped);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `${s.length}-${h.toString(16)}`;
}

export function mountHelper(node: AssemblerNode) {
  const wrapper: Component = {
    setup() {
      // Snapshot is cheap to compute (no fetch); the API-backed roll
      // happens out-of-band, keyed by `chainKey`, and writes its
      // result into `apiResolved`. The component reads whichever has
      // data — API result if cached, else the synchronous fallback.
      const snapshot = reactiveFromGraph<UpstreamSnapshot>(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => {
          // See `widgets/context.ts` for the rationale — `app.graph`
          // becomes a subgraph reference when the user is viewing one,
          // breaking root-level walks. Climb from `node.graph` instead.
          const startGraph =
            (node as unknown as { graph?: LiteGraphLike }).graph
            ?? (app.graph as unknown as LiteGraphLike);
          const g = findRootGraph(startGraph);
          const chain = collectUpstreamChain(g, node);
          return {
            chainKey: hashChain(chain),
            chain,
            fallbackResolved: collectUpstreamResolved(g, node),
            injectorKeys: collectUpstreamInjectorBindings(g, node),
            template: templateOf(node),
          };
        },
        snapshotEqual,
      );

      // Litegraph mode tracker — instant updates via property
      // intercept in reactiveFromGraph. Drives the dim overlay on
      // the helper widget when the assembler node is muted/bypassed.
      const nodeMode = reactiveFromGraph(
        node as unknown as Parameters<typeof reactiveFromGraph>[0],
        () => (node as unknown as { mode?: number }).mode ?? 0,
        Object.is,
      );

      // API-backed resolved map. Updates whenever `chainKey` shifts.
      const apiResolved = ref<Record<string, string> | null>(null);
      const apiKey = ref<string>("");
      // Inflight de-dup so a slow fetch from the previous chain doesn't
      // overwrite a fast fetch from the current one.
      let inflightKey = "";

      function refetchIfChanged() {
        const key = snapshot.value.chainKey;
        if (key === apiKey.value || key === inflightKey) return;
        inflightKey = key;
        // Trim to the engine-relevant whitelist before posting too —
        // keeps the request body in lockstep with the hash that
        // gated us here. Server only needs what the handlers will
        // read; sending UI-only fields wastes bandwidth + risks
        // server-side cache fragmentation.
        const chain = relevantChain(snapshot.value.chain);
        fetch("/wp/api/preview/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chain, seed: PREVIEW_SEED }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((body: { resolved?: Record<string, string> } | null) => {
            // Stale-response guard: if another fetch started after us,
            // drop ours so we don't clobber the newer state.
            if (inflightKey !== key) return;
            if (body && typeof body.resolved === "object" && body.resolved !== null) {
              // Only swap the ref when the resolved map ACTUALLY differs
              // — Vue tracks the ref read, so reassigning to an
              // identical object would still trigger a re-render. The
              // FNV-keyed cache key already gates by chain payload but
              // the resolution can be identical for distinct chains
              // (e.g. last_locked_seed-only edits, no-op enables).
              if (!shallowEqualResolved(apiResolved.value, body.resolved)) {
                apiResolved.value = body.resolved;
              }
              apiKey.value = key;
            }
          })
          .catch(() => {
            // Network / server error — leave previous apiResolved on
            // screen; fallback only kicks in if we never had any API
            // result.
          })
          .finally(() => {
            if (inflightKey === key) inflightKey = "";
          });
      }

      // Template variable extraction — matches the same regex AssemblerHelper
      // uses internally so chip state and preview tokenisation stay in sync.
      const TEMPLATE_VAR_RE = /(?<!\$)\$([A-Za-z_][A-Za-z0-9_]*)/g;

      return () => {
        refetchIfChanged();
        // Stickiness: once we have ANY API result, keep showing it
        // through chain edits — even if the server hasn't responded
        // yet. The previous resolved map is almost always closer to
        // the truth than the client-side option-[0] fallback, and
        // showing the fallback for one tick caused the visible
        // "3-different-previews" flicker on lock toggles. Fallback
        // only renders when we've never had an API response (first
        // mount before /wp/api/preview/resolve has settled).
        // INJECTOR LAYERING: the API-side resolver only knows about
        // WP_Context modules — injector bindings live in the static
        // fallback only. Two-pass merge:
        //   1. Start with fallback (has injector keys + Context stubs)
        //   2. Overlay api on top (better Context values)
        //   3. Re-overlay fallback values for INJECTOR-CONTRIBUTED
        //      keys (`$<binding>` placeholder) — at runtime the
        //      injector overwrites whatever Context wrote, so the
        //      preview must reflect that ordering. Without this
        //      override, an upstream Context "test" would render its
        //      resolved value even when a downstream injector wires
        //      "test" to a different upstream value.
        const fallback = snapshot.value.fallbackResolved;
        const api = apiResolved.value;
        const injectorKeys = snapshot.value.injectorKeys;
        let fresh: Record<string, string>;
        if (api) {
          fresh = { ...fallback, ...api };
          for (const k of injectorKeys) {
            if (k in fallback) fresh[k] = fallback[k];
          }
        } else {
          fresh = fallback;
        }
        const template = snapshot.value.template;

        // Compute new-layout props ----------------------------------------
        const upstreamVars = Object.keys(fresh);

        const templateVarsArr: string[] = [];
        const seen = new Set<string>();
        for (const m of template.matchAll(TEMPLATE_VAR_RE)) {
          if (m[1] && !seen.has(m[1])) {
            seen.add(m[1]);
            templateVarsArr.push(m[1]);
          }
        }

        // Pass the per-var resolved map directly. AssemblerHelper tokenises
        // the preview against this map so each var's resolved substring
        // gets its own color even when one var's value contains the
        // literal that bounds the next (e.g. `$hair_style $mood` where
        // $hair_style → "short cropped" — boundary disambiguation
        // would otherwise mis-color across the embedded space).
        // -----------------------------------------------------------------

        return h(AssemblerHelper, {
          upstreamVars,
          templateVars: templateVarsArr,
          template,
          resolvedMap: fresh,
          previewSeed: PREVIEW_SEED,
          nodeMode: nodeMode.value,
          onInsert: (token: string) => insertIntoTemplate(node, token),
          onRemoveVar: (varname: string) => removeFromTemplate(node, varname),
        });
      };
    },
  };
  const assemblerHost = createDomWidgetHost(node, "assembler-helper", wrapper, {
    minHeight: 80,
    minWidth: 280,
  });
  attachThemeDetector(assemblerHost.widget.element, app);
}

function insertIntoTemplate(node: AssemblerNode, token: string) {
  const w = node.widgets?.find((x) => x.name === "template") as
    | { name: string; value: unknown; inputEl?: HTMLTextAreaElement | HTMLInputElement }
    | undefined;
  if (!w || typeof w.value !== "string") return;

  // Multiline STRING widgets in ComfyUI back the input with a real <textarea>
  // exposed at widget.inputEl. If we can find it, splice the token at the
  // current caret. If not (collapsed canvas mode, etc.), fall back to a
  // smart-append.
  const el = w.inputEl;
  if (el && typeof el.selectionStart === "number") {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const needsLeadingSpace = start > 0 && !/\s$/.test(el.value.slice(0, start));
    const insert = `${needsLeadingSpace ? " " : ""}${token}`;
    el.value = el.value.slice(0, start) + insert + el.value.slice(end);
    w.value = el.value;
    // Restore focus + place caret immediately after the inserted token.
    el.focus();
    const caret = start + insert.length;
    el.setSelectionRange(caret, caret);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  // Fallback: append with a single-space separator.
  const cur = w.value;
  w.value = `${cur}${cur.endsWith(" ") || !cur ? "" : " "}${token}`;
}

/**
 * Strip every `$varname` occurrence (with word-boundary on the trailing
 * end so `$foo` doesn't match `$foobar`) from the template. Collapses
 * any double-spaces left behind. Wired to the AssemblerHelper's
 * UNRESOLVED chips so users can one-click drop names that no upstream
 * module binds.
 *
 * Mirrors the textarea-vs-fallback split of {@link insertIntoTemplate}
 * so caret + native input event fire the same way — downstream
 * widgets/listeners stay in sync regardless of which path runs.
 */
function removeFromTemplate(node: AssemblerNode, varname: string) {
  const w = node.widgets?.find((x) => x.name === "template") as
    | { name: string; value: unknown; inputEl?: HTMLTextAreaElement | HTMLInputElement }
    | undefined;
  if (!w || typeof w.value !== "string") return;

  // Word-boundary `\b` after the name so `$foo` doesn't blow up `$foobar`.
  // Allow optional leading whitespace to be eaten with the var so we
  // don't leave "  " gaps; collapse any leftover doubles afterwards.
  const stripRe = new RegExp(`\\s?\\$${escapeRegex(varname)}\\b`, "g");
  const next = w.value.replace(stripRe, "").replace(/[ \t]{2,}/g, " ").replace(/^[ \t]+/, "");

  const el = w.inputEl;
  if (el) {
    el.value = next;
    w.value = next;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  w.value = next;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
