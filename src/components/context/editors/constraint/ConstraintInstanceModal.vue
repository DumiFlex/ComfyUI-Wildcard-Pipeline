<script setup lang="ts">
/**
 * ConstraintInstanceModal — single-pane v2 modal for constraint
 * modules. Library-defining edits (matrix shape, source/target
 * wildcard pair, exception authoring) live in the SPA. Modal
 * exposes per-instance overrides:
 *   - Display name (`meta.name`)
 *   - Per-cell mode + factor overrides
 *   - Per-cell disable (5-state cycle includes "disabled")
 *   - Per-exception mode + factor overrides + disable checkbox
 *   - Extra (instance-only) exceptions
 *
 * Section order: Header → Identity → Matrix → Exceptions → Footer.
 * NO Runtime section — constraint produces no $vars (engine returns
 * empty bindings dict from resolve), and engine doesn't honor
 * `locked_seed` for this kind. Dropping the section is honest;
 * dimmed dead UI would lie.
 */
import { computed, watch } from "vue";
import type { ModuleEntry } from "../../../../widgets/_shared";
import type { ChainModule, TargetSelect } from "../../../../extension/constraint-pairs";
import IdentitySection from "./sections/IdentitySection.vue";
import MatrixSection from "./sections/MatrixSection.vue";
import TargetReachSection from "./sections/TargetReachSection.vue";
import ExceptionsSection from "./sections/ExceptionsSection.vue";
// Library fallback for cross-Context constraints. When the referenced
// source/target wildcard isn't a sibling in this WP_Context (lives in
// another node, or library-only), pull its sub_categories + option
// list from the preview-resolver cache so the matrix, axes labels,
// exception chips, and autocomplete suggestions reflect the live
// wildcard instead of the saved-matrix's frozen keys.
import { cacheVersion, ensure, lookup } from "../../../../extension/preview-resolver";

const props = withDefaults(
  defineProps<{
    module: ModuleEntry;
    isDrifted?: boolean;
    /** True when draft has unsaved instance edits. Gates "Save to library"
     *  visibility — pushing an unmodified payload back is a no-op. */
    isModified?: boolean;
    /** Sibling modules in the same WP_Context — used to populate
     *  matrix axes (sub_categories) + extra-exception autocomplete
     *  (option values). Optional; falls back to empty axes. */
    siblingModules?: ModuleEntry[];
    /** Flattened cross-node module chain (upstream + own + downstream
     *  WP_Context nodes), computed at the mount layer. Lets the modal
     *  resolve a source/target wildcard that lives in a DOWNSTREAM (or
     *  upstream) Context node — not just the same node. A superset of
     *  `siblingModules` (the own node's modules appear in the chain
     *  too), so merging is safe; chain entries win on uuid collision.
     *  Optional — undefined in headless/legacy mounts falls back to
     *  `siblingModules` alone. */
    chainModules?: ChainModule[];
  }>(),
  { isDrifted: false, isModified: false, siblingModules: () => [] },
);

const emit = defineEmits<{
  "update": [patch: Partial<ModuleEntry>];
  "save": [];
  "cancel": [];
  "open-spa": [];
  "save-to-library": [];
  "clear-all-overrides": [];
}>();

const isLibraryTracked = computed(() => Boolean(props.module.payload_hash));
// See WildcardInstanceModal — PushToLibraryModal owns the update vs fork
// choice, so save-to-library is always available when payload exists.
const canSaveToLibrary = computed(() => Boolean(props.module.payload));

function spaUrl(): string {
  return `/wp/constraints/${props.module.id}/edit`;
}

interface WildcardPayload {
  sub_categories?: string[];
  options?: Array<{ value?: string }>;
}

/** Normalised module shape the resolution lookups consume. Unifies the
 *  two source shapes: `ModuleEntry` (same-node siblings — name under
 *  `meta.name`) and `ChainModule` (cross-node chain — name under
 *  `displayName`). Carrying a flat `name` lets `findWildcardModule` +
 *  `wildcardName` stay shape-agnostic. */
interface LookupModule {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  name?: string;
}

/** Merge of the cross-node chain (`chainModules`) and same-node
 *  siblings (`siblingModules`), keyed by uuid. Chain entries win on
 *  collision: the chain is a superset that already includes the current
 *  node's modules, and it carries the authoritative cross-node view, so
 *  preferring it keeps same-node behaviour identical (same payload) while
 *  adding reach to downstream/upstream targets. Deduped by id. */
const modulesForLookup = computed<LookupModule[]>(() => {
  const byId = new Map<string, LookupModule>();
  // Siblings first so chain entries (added second) overwrite on uuid.
  for (const s of props.siblingModules) {
    if (s.type !== "wildcard") continue;
    byId.set(s.id, {
      id: s.id,
      type: s.type,
      payload: (s.payload ?? {}) as Record<string, unknown>,
      name: s.meta?.name,
    });
  }
  for (const c of props.chainModules ?? []) {
    if (c.type !== "wildcard") continue;
    byId.set(c.id, {
      id: c.id,
      type: c.type,
      payload: (c.payload ?? {}) as Record<string, unknown>,
      name: c.displayName,
    });
  }
  return [...byId.values()];
});

function findWildcardModule(id: string | null | undefined): LookupModule | null {
  if (!id) return null;
  const m = modulesForLookup.value.find((x) => x.id === id);
  if (!m || m.type !== "wildcard") return null;
  return m;
}

function findWildcard(id: string | null | undefined): WildcardPayload | null {
  const m = findWildcardModule(id);
  return m ? ((m.payload ?? {}) as WildcardPayload) : null;
}

/** Chain/sibling first, then preview-resolver cache. Returns the
 *  wildcard's display name; for chain entries the `displayName` is
 *  `meta.name` at flatten time. A `$var`-bound wildcard with no human
 *  title (common for cross-node chain entries) falls to its
 *  `var_binding`, then the cache's varBinding/name. Empty string when
 *  no source knows the uuid. Display name is preferred over var_binding
 *  so a same-node sibling's human title still wins (unchanged). */
function wildcardName(id: string | null | undefined): string {
  const m = findWildcardModule(id);
  if (m?.name) return m.name;
  const binding = (m?.payload?.var_binding as string | undefined)?.trim().replace(/^\$+/, "");
  if (binding) return binding;
  if (!id) return "";
  void cacheVersion.value;
  const hit = lookup(id);
  return hit?.varBinding?.trim() || hit?.name?.trim() || "";
}

// Fire `ensure()` for any source/target uuid not loaded as a sibling
// so the resolver kicks a fetch on modal open. Reactive cacheVersion
// reads inside the computeds below catch the result.
watch(
  () => {
    const pl = (props.module.payload ?? {}) as ConstraintPayload;
    return [pl.source_wildcard_id, pl.target_wildcard_id] as const;
  },
  ([sid, tid]) => {
    const missing: string[] = [];
    if (typeof sid === "string" && sid && !findWildcardModule(sid)) missing.push(sid);
    if (typeof tid === "string" && tid && !findWildcardModule(tid)) missing.push(tid);
    if (missing.length) ensure(missing);
  },
  { immediate: true },
);

interface ConstraintPayload {
  source_wildcard_id?: string;
  target_wildcard_id?: string;
  matrix?: Record<string, Record<string, unknown>>;
  exceptions?: Array<{ source_value?: string; target_value?: string; source?: string; target?: string }>;
  target_select?: TargetSelect;
}

/** Pull the wildcard's live sub_categories, preferring sibling module
 *  (most fresh) over preview-resolver cache (cross-Context refs).
 *  Returns null when neither knows the uuid — caller falls back to
 *  matrix keys for that case so the user can still edit a stranded
 *  constraint. */
function liveSubCategories(id: string | null | undefined): string[] | null {
  const m = findWildcard(id);
  if (m?.sub_categories && m.sub_categories.length > 0) return m.sub_categories;
  if (!id) return null;
  void cacheVersion.value;
  const hit = lookup(id);
  if (hit?.subCategories && hit.subCategories.length > 0) return hit.subCategories;
  return null;
}

/**
 * Matrix axes — prefer the wildcard's *current* sub_categories list.
 * Falling back to saved-matrix keys for refs we know nothing about
 * lets the user edit a stranded constraint; using saved-matrix keys
 * for a known wildcard would surface stale rows/cols for sub-cats
 * the user deleted upstream.
 */
const sourceSubs = computed<string[]>(() => {
  const pl = (props.module.payload ?? {}) as ConstraintPayload;
  const live = liveSubCategories(pl.source_wildcard_id);
  if (live) return live;
  return Object.keys(pl.matrix ?? {});
});

const targetSubs = computed<string[]>(() => {
  const pl = (props.module.payload ?? {}) as ConstraintPayload;
  const live = liveSubCategories(pl.target_wildcard_id);
  if (live) return live;
  const set = new Set<string>();
  for (const row of Object.values(pl.matrix ?? {})) {
    for (const k of Object.keys(row ?? {})) set.add(k);
  }
  return Array.from(set);
});

/** Pull the wildcard's live option-value list, preferring sibling
 *  module over preview-resolver cache. Returns null when neither
 *  knows the uuid. */
function liveOptionValues(id: string | null | undefined): string[] | null {
  const live = (findWildcard(id)?.options ?? [])
    .map((o) => o.value ?? "")
    .filter(Boolean);
  if (live.length > 0) return live;
  if (!id) return null;
  void cacheVersion.value;
  const hit = lookup(id);
  if (hit?.optionValues && hit.optionValues.length > 0) return hit.optionValues;
  return null;
}

/**
 * Extra-exception autocomplete suggestions — prefer live wildcard
 * option values, fall back to the union of source/target values
 * already present in library exceptions so cross-Context constraints
 * still get useful suggestions.
 */
const sourceValues = computed<string[]>(() => {
  const pl = (props.module.payload ?? {}) as ConstraintPayload;
  const live = liveOptionValues(pl.source_wildcard_id);
  if (live) return live;
  const set = new Set<string>();
  for (const e of pl.exceptions ?? []) {
    const v = e.source_value ?? e.source ?? "";
    if (v) set.add(v);
  }
  return Array.from(set);
});

const targetValues = computed<string[]>(() => {
  const pl = (props.module.payload ?? {}) as ConstraintPayload;
  const live = liveOptionValues(pl.target_wildcard_id);
  if (live) return live;
  const set = new Set<string>();
  for (const e of pl.exceptions ?? []) {
    const v = e.target_value ?? e.target ?? "";
    if (v) set.add(v);
  }
  return Array.from(set);
});

const sourceName = computed(() => {
  const pl = (props.module.payload ?? {}) as ConstraintPayload;
  return wildcardName(pl.source_wildcard_id);
});
const targetName = computed(() => {
  const pl = (props.module.payload ?? {}) as ConstraintPayload;
  return wildcardName(pl.target_wildcard_id);
});

// ── Target reach (SP3) ──────────────────────────────────────────
//
// Effective `target_select`: per-instance override wins, then the
// library payload value, then the engine default `{mode:"all"}`. The
// section reads this; writes flow back into `instance.target_select`.
const targetSelect = computed<TargetSelect>(() => {
  const inst = props.module.instance?.target_select;
  if (inst && typeof inst === "object") return inst;
  const pl = (props.module.payload ?? {}) as ConstraintPayload;
  if (pl.target_select && typeof pl.target_select === "object") return pl.target_select;
  return { mode: "all" };
});

const targetWildcardId = computed<string>(() => {
  const pl = (props.module.payload ?? {}) as ConstraintPayload;
  return pl.target_wildcard_id ?? "";
});

/** The edited constraint's row id, as it appears in `chainModules`
 *  (`${nodeId}#${_uid}`). The pick checklist walks DOWNSTREAM of this
 *  row, so it must match the chain's `rowKey` — find the constraint chain
 *  entry by `_uid` suffix (preferred) or `id`. Falls back to the bare
 *  `_uid`/`id` when the chain is absent (headless/legacy mounts) — the
 *  section then renders an empty checklist rather than crashing. */
const constraintUid = computed<string>(() => {
  const uid = props.module._uid;
  const chain = props.chainModules ?? [];
  const hit = chain.find((m) => {
    if (m.type !== "constraint") return false;
    if (uid && m.rowKey.endsWith(`#${uid}`)) return true;
    return m.id === props.module.id;
  });
  return hit?.rowKey ?? uid ?? props.module.id;
});

/** True when `next` is exactly what the constraint resolves to with NO
 *  per-instance override — the EFFECTIVE library default
 *  (`payload.target_select`, itself defaulting to `{mode:"all"}`). Only then
 *  is collapsing to `null` ("inherit library") lossless. */
function reachEqualsLibraryDefault(next: TargetSelect): boolean {
  const lib = ((props.module.payload ?? {}) as ConstraintPayload).target_select ?? { mode: "all" };
  if (next.mode !== lib.mode) return false;
  if (next.mode === "next") return Number(next.count ?? 1) === Number(lib.count ?? 1);
  // `pick` never matches the (pick-less) library default; first/all match on mode.
  return next.mode !== "pick";
}

/** Persist a new `target_select` onto the instance. Mirrors the modal's
 *  other instance writes (full-replacement values, shallow-merged).
 *  Collapse to `null` ONLY when `next` equals the effective library default
 *  (null = "inherit library") — keeps an untouched reach out of the instance
 *  while PRESERVING a real override. The old `mode === "all"` collapse lost
 *  an explicit `all` placed over a non-all library default: the engine's
 *  `instance ?? payload ?? all` then fell back to the library value, so the
 *  user's widen-to-all was silently ignored. */
function onTargetSelect(next: TargetSelect): void {
  const inherits = reachEqualsLibraryDefault(next);
  emit("update", {
    instance: {
      ...(props.module.instance ?? {}),
      target_select: inherits ? null : next,
    },
  });
}

/** Tell the ExceptionsSection whether the source / target wildcard
 *  carries a null option. Drives the pi-ban chip render on library
 *  exception rows whose value is the empty string (null option key). */
function liveHasNullOption(id: string | null | undefined): boolean {
  const opts = findWildcard(id)?.options ?? [];
  if (opts.some((o: unknown) => (o as { is_null?: boolean }).is_null === true)) return true;
  if (!id) return false;
  void cacheVersion.value;
  return lookup(id)?.hasNullOption === true;
}
const sourceHasNull = computed<boolean>(() => {
  const pl = (props.module.payload ?? {}) as ConstraintPayload;
  return liveHasNullOption(pl.source_wildcard_id);
});
const targetHasNull = computed<boolean>(() => {
  const pl = (props.module.payload ?? {}) as ConstraintPayload;
  return liveHasNullOption(pl.target_wildcard_id);
});

/** Per-option id → value lookup for the source / target wildcards.
 *  Used as a fallback by ExceptionsSection when a library exception
 *  payload carries `source_id` / `target_id` but no `source` / `target`
 *  string (e.g. legacy payloads where the rehydrate-from-ids step
 *  never ran). Without this fallback the exception rows render as
 *  blank chips. */
function liveOptionsById(id: string | null | undefined): ReadonlyMap<string, string> {
  const opts = findWildcard(id)?.options ?? [];
  const m = new Map<string, string>();
  for (const o of opts as Array<{ id?: string; value?: string }>) {
    if (typeof o?.id === "string" && typeof o?.value === "string") {
      m.set(o.id, o.value);
    }
  }
  if (m.size > 0 || !id) return m;
  void cacheVersion.value;
  return lookup(id)?.optionsById ?? m;
}
const sourceOptionsById = computed<ReadonlyMap<string, string>>(() => {
  const pl = (props.module.payload ?? {}) as ConstraintPayload;
  return liveOptionsById(pl.source_wildcard_id);
});
const targetOptionsById = computed<ReadonlyMap<string, string>>(() => {
  const pl = (props.module.payload ?? {}) as ConstraintPayload;
  return liveOptionsById(pl.target_wildcard_id);
});

/** Wildcard uuid → display name map, threaded through to
 *  `ExceptionsSection` so embedded `@{uuid}` nested-ref tokens inside
 *  exception values render via `RichTextPreview` as the same purple ref
 *  chip the value editor shows — instead of raw `@{c0f09840}` text. */
const uuidToName = computed<ReadonlyMap<string, string>>(() => {
  const m = new Map<string, string>();
  // modulesForLookup already merges chain (cross-node) + siblings and
  // filters to wildcards, so nested `@{uuid}` refs pointing at a
  // downstream-node wildcard resolve to a name too (not raw uuid).
  for (const mod of modulesForLookup.value) {
    const name = mod.name;
    if (typeof name === "string" && name.length > 0) m.set(mod.id, name);
  }
  return m;
});

function onUpdate(patch: Partial<ModuleEntry>): void {
  emit("update", patch);
}

function onSpaClick(): void {
  emit("open-spa");
  window.open(spaUrl(), "_blank", "noopener");
}
</script>

<template>
  <div class="cnm">
    <header class="wp-cnm__head">
      <i class="pi pi-link wp-cnm__head-icon" aria-hidden="true" />
      <div class="wp-cnm__title-block">
        <div class="wp-cnm__title-row">
          <span class="wp-cnm__name" data-test="cnm-name">{{ module.meta?.name ?? module.type }}</span>
          <span class="wp-cnm__chip" data-test="cnm-chip">constraint</span>
        </div>
        <div class="wp-cnm__sub">Library entry · source pick → modifies target option weights</div>
      </div>
      <button
        type="button"
        class="wp-cnm__close"
        aria-label="Close"
        data-test="cnm-close"
        @click="emit('cancel')"
      ><i class="pi pi-times" aria-hidden="true" /></button>
    </header>

    <IdentitySection :module="module" @update="onUpdate" />
    <MatrixSection
      :module="module"
      :source-subs="sourceSubs"
      :target-subs="targetSubs"
      :source-name="sourceName"
      :target-name="targetName"
      @update="onUpdate"
    />
    <TargetReachSection
      :model-value="targetSelect"
      :chain-modules="chainModules"
      :constraint-uid="constraintUid"
      :target-wildcard-id="targetWildcardId"
      :target-name="targetName"
      @update:model-value="onTargetSelect"
    />
    <ExceptionsSection
      :module="module"
      :source-values="sourceValues"
      :target-values="targetValues"
      :source-has-null="sourceHasNull"
      :target-has-null="targetHasNull"
      :source-options-by-id="sourceOptionsById"
      :target-options-by-id="targetOptionsById"
      :uuid-to-name="uuidToName"
      @update="onUpdate"
    />

    <footer class="wp-cnm__foot">
      <a
        v-if="isLibraryTracked"
        class="wp-cnm__spa-link"
        :href="spaUrl()"
        target="_blank"
        rel="noopener"
        data-test="cnm-spa-link"
        @click.prevent="onSpaClick"
      >
        <i class="pi pi-external-link" aria-hidden="true" />
        Edit library entry in SPA
      </a>
      <button
        type="button"
        class="wp-cnm__btn wp-cnm__btn--quiet"
        data-test="cnm-clear-all"
        title="Clear all instance overrides on this constraint"
        @click="emit('clear-all-overrides')"
      >
        <i class="pi pi-replay" aria-hidden="true" />
        Reset overrides
      </button>
      <span class="wp-cnm__hint">
        <kbd>Esc</kbd> cancel · <kbd>⌘↵</kbd> save
      </span>
      <button
        v-if="canSaveToLibrary"
        type="button"
        class="wp-cnm__btn"
        data-test="cnm-save-lib"
        @click="emit('save-to-library')"
      >Save to library</button>
      <button type="button" class="wp-cnm__btn" data-test="cnm-cancel" @click="emit('cancel')">Cancel</button>
      <button type="button" class="wp-cnm__btn wp-cnm__btn--primary" data-test="cnm-save" @click="emit('save')">Save</button>
    </footer>
  </div>
</template>

<style scoped>
.cnm {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  width: 820px;
  max-width: 100%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  color: var(--wp-text);
}
/* Head styling lives in src/components/context/editors/_modal-head.css
 * (imported once by ContextWidget). */
.wp-cnm__foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--wp-bg3);
  border-top: 1px solid var(--wp-border);
}
.wp-cnm__spa-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
  text-decoration: none;
}
.wp-cnm__spa-link:hover { color: var(--wp-accent-text, var(--wp-text)); }
.wp-cnm__hint {
  margin-left: auto;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-cnm__hint kbd {
  font: 9px var(--wp-font-mono);
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  padding: 1px 4px;
  border-radius: 2px;
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-cnm__btn {
  padding: 5px 12px;
  border: 1px solid var(--wp-border);
  border-radius: 3px;
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 11px var(--wp-font-sans);
  cursor: pointer;
}
.wp-cnm__btn--primary {
  border-color: var(--wp-accent);
  background: var(--wp-accent);
  color: white;
}
.wp-cnm__btn--quiet {
  border-color: transparent;
  color: var(--wp-text-dim, var(--wp-text3));
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
}
.wp-cnm__btn--quiet:hover {
  border-color: var(--wp-border);
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-cnm__btn--quiet .pi { font-size: 10px; }
</style>
