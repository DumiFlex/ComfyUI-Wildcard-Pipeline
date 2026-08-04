<!-- src/manager/components/RefChip.vue -->
<script setup lang="ts">
import { computed, inject, ref, onBeforeUnmount } from "vue";
import { KIND_ICON_MAP } from "../../components/shared/kind-icons";
import { parse, readsAs, matches } from "@/manager/parsing/subcatFilter";
import { splitRefFilter } from "@/widgets/richTokenize";
// Live library lookup — the hover card's "N of M options match" count reads
// the referenced wildcard's CURRENT option list from here, so adding an option
// in the library moves the count (the propagation signal issue #3 asked for).
import { cacheVersion, ensure, lookup } from "@/extension/preview-resolver";
// Context-node pools. The engine resolves a nested ref against the node's own
// frozen snapshot when the uuid is picked there, and only falls back to the
// library otherwise — so the card has to apply the same precedence or it
// reports numbers the graph will not use.
import {
  CONTEXT_POOLS_KEY,
  FOREIGN_POOL_LOOKUP_KEY,
  resolvePoolFor,
  type ContextPoolMap,
} from "@/extension/context-pools";

/** Module kind for the `moduleKind` prop. Mirrors `ModuleKind` in
 *  `src/manager/cascade/resolveChip.ts` — duplicated as a local literal
 *  union so this component stays free of cascade-layer imports. */
type ChipModuleKind =
  | "wildcard" | "fixed_values" | "combine" | "derivation" | "constraint" | "bundle";

interface Props {
  /** "ref" → @{uuid} chip, "var" → $name chip. */
  kind: "ref" | "var";
  /** Display name. For unresolved refs this is empty; uuid is shown instead. */
  name: string;
  /** SP2a list accessor for a var chip: `$name.K` (0-based). Ignored by refs. */
  index?: number;
  /** UUID of the wildcard library entry (ref-kind only). */
  uuid?: string;
  /** True when the name resolved against the catalog / surface. False → render as red `?` chip. */
  resolved: boolean;
  /** Boolean sub-category filter expression (ref-kind only). Empty /
   *  undefined = no expression. The expression itself is NOT shown
   *  inline (it can be long); a funnel indicator marks "filtered" and
   *  the full normalized form ("reads as") lives in the hover title. */
  expr?: string;
  /** Exclude-null flag (ref-kind only). True drops the wildcard's null
   *  option from the resolved pool (inverted-null semantic, 2026-05-25).
   *  Surfaces alongside the funnel + in the hover title. */
  excludeNull?: boolean;
  /** @deprecated Legacy flat sub-category list (pre-SP1). Superseded by
   *  the boolean `expr` + `excludeNull` pair. Still accepted so callers
   *  that have not yet migrated keep compiling + showing a funnel; when
   *  `expr` is empty this list is reconstructed into an effective
   *  expression (comma = OR) and a trailing `"null"` token maps to
   *  `excludeNull`. New callers should pass `expr` / `excludeNull`. */
  subCategories?: string[];
  /** Module kind the resolved uuid points at — drives the chip's color
   *  (CSS custom property `--wp-refchip-tone`) + the leading PrimeIcon.
   *  Defaults to `wildcard` so existing callers that pass no `moduleKind`
   *  keep the legacy violet wildcard styling. Only honoured when the
   *  chip is `kind="ref"` AND `resolved` — unresolved chips stay red
   *  regardless. Var chips ignore this prop entirely. */
  moduleKind?: ChipModuleKind;
  /** VAR chips only: is this name present in the host's suggestion pool?
   *
   *  `resolved` cannot answer this — for a var it is just `name.length > 0`
   *  (see `atomIsResolved` in RichTextInput), deliberately permissive so a
   *  legitimate runtime-bound var never renders as a broken red chip. The
   *  hover nonetheless read `resolved ? "produced upstream" : …`, so EVERY
   *  var claimed an upstream producer — wrong in the SPA, which has no graph
   *  at all, and unverified on the canvas.
   *
   *  Defaults false so a caller that passes no pool makes no claim: the chip
   *  falls back to "binds at runtime", which is always true. */
  inScope?: boolean;
  /** VAR chips only: WHO writes this name.
   *
   *  Canvas hosts pass the entry from `collectUpstreamProducers` — the winning
   *  writer plus its node and module. Absent means the host has no graph (the
   *  SPA) or nothing upstream writes the name; the card then says so instead
   *  of implying a producer exists. `kind` alone was never enough to act on
   *  when several near-identical modules bind the same var. */
  producer?: VarProducerLike;
  /** Set by hosts that actually walked a graph (the canvas). Lets the card
   *  distinguish "nothing upstream writes this" — actionable, the user may
   *  have a missing link — from "this surface has no graph to walk" (the SPA
   *  library editor), which must never be reported as a missing producer.
   *  Cannot be inferred from `producer`: a graph-aware host legitimately finds
   *  no writer. */
  graphAware?: boolean;
}

/** Structural mirror of `extension/graph.ts:VarProducer`, declared locally so
 *  the SPA build never pulls the canvas graph walker in just for a type. */
export interface VarProducerLike {
  kind: string;
  /** Where the writer lives. Canvas passes a node codename / title; the SPA
   *  has no graph, so it passes nothing and the card omits the "in …" clause. */
  nodeLabel?: string;
  moduleName?: string;
  moduleId?: string;
  internal?: boolean;
  /** Canvas: how many earlier writes this one overrode (last-write-wins).
   *  SPA: how many OTHER library modules bind the same name — no execution
   *  order exists there, so it reads as "N others bind this" rather than as an
   *  override. `siblingLabel` distinguishes the two. */
  shadowed: number;
  /** Wording for the `shadowed` count. Defaults to the canvas override
   *  phrasing; the SPA passes its own since nothing is overridden there. */
  siblingLabel?: string;
}

const props = withDefaults(defineProps<Props>(), {
  uuid: "",
  expr: "",
  excludeNull: false,
  subCategories: () => [],
  moduleKind: "wildcard",
  inScope: false,
  producer: undefined,
  graphAware: false,
});

const emit = defineEmits<{
  /** Fired when a RESOLVED ref-kind chip body is clicked. The MouseEvent
   *  payload lets the parent read the chip's bounding rect (via
   *  `ev.currentTarget`) so it can anchor a popover near the chip. */
  "click": [event: MouseEvent];
  /** Fired when an UNRESOLVED (broken) ref-kind chip body is clicked.
   *  Distinct from `click` ON PURPOSE: hosts wired to `@click` expect
   *  only the resolved edit-popover event, so the broken-chip remap
   *  affordance gets its own channel (spec Component A "Trigger").
   *  Var-kind chips never emit. */
  "remap": [event: MouseEvent];
}>();

const isRef = computed(() => props.kind === "ref");

/** Effective filter for the chip, resolving the canonical `expr` /
 *  `excludeNull` props against the deprecated `subCategories` fallback.
 *  When `expr` is empty, a legacy list is reconstructed (comma = OR) and
 *  a trailing reserved `"null"` token maps to `excludeNull` — mirrors the
 *  pre-SP1 inverted-null semantic so unmigrated callers keep working. */
const filter = computed<{ expr: string; excludeNull: boolean }>(() => {
  const rawExpr = props.expr.trim();
  if (rawExpr.length > 0) {
    return { expr: rawExpr, excludeNull: props.excludeNull };
  }
  if (props.subCategories.length > 0) {
    // Two null conventions reach this legacy prop: a standalone "null"
    // element (pre-SP1 inverted-null list) and a glued trailing `!null` on
    // the v2 lexer's single-element body (the lexer comma-splits without
    // peeling). Strip the standalone element, then peel any glued marker off
    // the rejoined body so `["warm or intense!null"]` becomes
    // `{ expr: "warm or intense", excludeNull: true }` rather than showing
    // `warm or intense!null` raw in the hover title.
    const standaloneNull = props.subCategories.includes("null");
    const terms = props.subCategories.filter((s) => s !== "null");
    const peeled = splitRefFilter(terms.join(","));
    return {
      expr: peeled.expr,
      excludeNull: props.excludeNull || standaloneNull || peeled.excludeNull,
    };
  }
  return { expr: "", excludeNull: props.excludeNull };
});

const hasExpr = computed(() => isRef.value && filter.value.expr.length > 0);
/** A ref carries a filter when it has an expression OR opts the null
 *  option out. Either drives the compact funnel indicator. */
const isFiltered = computed(
  () => isRef.value && (hasExpr.value || filter.value.excludeNull),
);

/** Normalized expression for the hover tooltip — the full expression is
 *  NOT shown inline (it can be long), only on hover via "reads as".
 *  Falls back to the raw expression if it doesn't parse (shouldn't
 *  happen for serialized refs, but keeps a broken token legible). */
/** Human label for the producer's kind. `injector` / `loop` describe a NODE
 *  rather than a module, so they read differently from the module kinds. */
const PRODUCER_KIND_LABEL: Record<string, string> = {
  wildcard: "wildcard",
  fixed_values: "fixed value",
  combine: "combine",
  derivation: "derivation",
  injector: "injector row",
  loop: "loop variable",
};
const producerKindLabel = computed<string>(() =>
  PRODUCER_KIND_LABEL[props.producer?.kind ?? ""] ?? (props.producer?.kind ?? ""),
);

/** Wording for the sibling/override count. The canvas has an execution order
 *  so it can say the winner overrode the rest; the library has none, so it can
 *  only report that other modules bind the same name. */
const siblingText = computed<string>(() => {
  const p = props.producer;
  if (!p || p.shadowed <= 0) return "";
  const n = p.shadowed;
  if (p.siblingLabel) return `${n} other ${p.siblingLabel}${n === 1 ? "" : "s"} bind this name`;
  return `overrides ${n} earlier ${n === 1 ? "write" : "writes"}`;
});

const readsAsExpr = computed(() => {
  if (!hasExpr.value) return "";
  try {
    return readsAs(parse(filter.value.expr));
  } catch {
    return filter.value.expr;
  }
});

/**
 * Always the empty string, which is not the same as omitting the attribute.
 *
 * Per HTML, an empty `title` means "this element has no advisory information"
 * and STOPS the lookup walking to an ancestor. That matters because chips sit
 * inside containers that carry their own `title` (the derivation rule/branch
 * summaries put the full row text there), so hovering a chip used to raise the
 * container's native tooltip on top of the chip's own hover card — two
 * overlapping popups describing different things.
 *
 * Nothing is lost: the filter's "reads as" and the excluded-null note both
 * render inside the hover card, so the native tooltip was duplicating it.
 */
const filterTitle = "";

/** Whether the exclude-null mark should render (effective flag). */
const showNoNull = computed(() => isRef.value && filter.value.excludeNull);

const label = computed(() => {
  // SP2a: a var chip may carry a `.K` list accessor (`$colors.0`); refs never do.
  const idxSuffix = !isRef.value && props.index != null ? "." + props.index : "";
  if (!props.resolved) {
    // Unresolved refs prefer the cached `#name` (kept on the ref atom
    // from the `@{uuid#name}` syntax) so a broken reference still
    // tells the user which wildcard was originally there. Falls back
    // to the uuid when no cached name is available (legacy bare-uuid
    // refs / older workflows). Vars keep showing the bare name.
    if (props.kind === "ref") {
      return props.name && props.name.length > 0 ? props.name : props.uuid;
    }
    return props.name + idxSuffix;
  }
  return (isRef.value ? "@" : "$") + props.name + idxSuffix;
});

/** Per-kind color CSS variable used as the chip's `--wp-refchip-tone`.
 *  `wildcard` keeps the legacy `--wp-kind-wildcard` (kind-aware path
 *  skipped). `bundle` has no `--wp-kind-bundle` token — falls back to
 *  text-muted, matching `toneVar("bundle")` in docs/registry.ts. */
const KIND_TONE: Record<ChipModuleKind, string> = {
  wildcard:     "var(--wp-kind-wildcard)",
  fixed_values: "var(--wp-kind-fixed)",
  combine:      "var(--wp-kind-combine)",
  derivation:   "var(--wp-kind-derivation)",
  constraint:   "var(--wp-kind-constraint)",
  bundle:       "var(--wp-text-muted)",
};

const isKindAware = computed(() =>
  isRef.value && props.resolved && props.moduleKind !== "wildcard",
);

const toneStyle = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {};
  if (isKindAware.value) out["--wp-refchip-tone"] = KIND_TONE[props.moduleKind];
  return out;
});

const kindIconCls = computed(() =>
  isKindAware.value ? KIND_ICON_MAP[props.moduleKind] : "",
);

const icon = computed(() => {
  if (!props.resolved) return "?";
  return isRef.value ? "✦" : "⌘";
});

function onClick(ev: MouseEvent): void {
  // Ref-kind only: resolved chips open the edit popover (`click`); broken
  // chips open the remap popup (`remap`). Var-kind chips are pure marks.
  if (!isRef.value) return;
  if (props.resolved) emit("click", ev);
  else emit("remap", ev);
}

// ── Hover card (issues #3 / #8): a small informational popover mirroring the
// constraint-pair card. Ref chips show uuid + filter "reads as" + "N of M
// options match" (the count is the propagation signal — it moves when library
// options change). Var chips show the binding + resolved state.
const HOVER_DELAY_MS = 280;
const hoverOpen = ref(false);
const popPos = ref<{ top: number; left: number; flip: boolean }>({ top: 0, left: 0, flip: false });
let hoverTimer: number | undefined;

/** Pools this Context node holds, when a Context node is an ancestor. Absent
 *  in the SPA library views, where every ref necessarily reads the library. */
const contextPools = inject<{ value: ContextPoolMap } | undefined>(
  CONTEXT_POOLS_KEY,
  undefined,
);

/** The pool a ref will ACTUALLY resolve against, plus where it came from.
 *  Null when neither the node nor the library has the row (card then shows
 *  "not in library"). Reactive on fetch via cacheVersion. */
const pool = computed(() => {
  void cacheVersion.value;
  if (!isRef.value || !props.uuid) return null;
  return resolvePoolFor(
    props.uuid,
    contextPools?.value,
    lookup(props.uuid)?.optionTagSets,
  );
});

/** Total options + how many survive the filter, computed over whichever pool
 *  won above — so the count always describes what the graph will do. */
const optionStats = computed<{ total: number; matched: number } | null>(() => {
  // An unresolved ref has nothing to count. Without this the card would print
  // a count sourced from whatever snapshot is still cached — which is the
  // deleted-module lie in its second form: the resolver may have been
  // corrected, but a chip told `resolved: false` by any other route (a uuid
  // absent from the live chain, say) would still quote stale numbers. The
  // count also outranks the broken branch in the template, so it would hide
  // the explanation entirely.
  if (isRef.value && !props.resolved) return null;
  const p = pool.value;
  if (!p || p.tagSets.length === 0) return null;
  const total = p.tagSets.length;
  if (!hasExpr.value) return { total, matched: total };
  const ast = parse(filter.value.expr);
  return { total, matched: p.tagSets.filter((tags) => matches(ast, new Set(tags))).length };
});

/** True when this node supplies the pool, so the chip can say so. */
const poolFromNode = computed(() => pool.value?.source === "context");

/** Human label for the winning pool. Names the module when the node supplies
 *  it, because a node can hold a renamed copy of a library row. */
const poolLabel = computed<string | null>(() => {
  // A broken ref has no pool. `resolvePoolFor` still answers "library" for an
  // unknown uuid — that is its fallback, not a finding — and printing it put
  // "not in library" and "pool: library" in the same card.
  if (isRef.value && !props.resolved) return null;
  const p = pool.value;
  if (!p) return null;
  if (p.source === "library") return "pool: library";
  return p.name ? `pool: this node · ${p.name}` : "pool: this node";
});

/** Set only when the losing pool disagrees — the card explains the
 *  discrepancy rather than leaving two different numbers unexplained. */
const poolDriftNote = computed<string | null>(() => {
  const p = pool.value;
  if (!p || p.otherTotal === undefined) return null;
  return `library has ${p.otherTotal} — refresh to use it`;
});

/** Canvas-only: which OTHER nodes hold this uuid. Resolved on hover rather
 *  than in a computed — it walks the whole graph, and only an open card ever
 *  reads it. */
const foreignLookup = inject(FOREIGN_POOL_LOOKUP_KEY, undefined);
const foreignHomes = ref<string[]>([]);

/**
 * Note for the case that reads as a bug but isn't: the pool is right there on
 * the canvas, in another node, and the ref used the library anyway.
 *
 * It does, because a `@{}` ref only sees its own node's modules plus the
 * library — a catalog is rebuilt per node and never crosses the socket. That
 * is not obvious from anywhere else in the UI, and it is the opposite of how
 * `$vars` behave, so the card states it outright.
 */
const foreignPoolNote = computed<string | null>(() => {
  if (pool.value?.source !== "library") return null;
  const homes = foreignHomes.value;
  if (homes.length === 0) return null;
  const where = homes.length === 1 ? homes[0] : `${homes.length} other nodes`;
  return `also in ${where} — other nodes don't share pools`;
});

function positionPop(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const POP_H = 120;
  const gap = 6;
  const margin = 8;
  const spaceBelow = window.innerHeight - r.bottom;
  const flip = spaceBelow < POP_H + gap + margin && r.top > spaceBelow;
  popPos.value = {
    top: flip ? Math.max(margin, r.top - gap) : r.bottom + gap,
    left: Math.max(margin, Math.min(r.left, window.innerWidth - 280 - margin)),
    flip,
  };
}

function onEnter(ev: MouseEvent): void {
  const el = ev.currentTarget as HTMLElement | null;
  if (!el) return;
  if (hoverTimer !== undefined) window.clearTimeout(hoverTimer);
  hoverTimer = window.setTimeout(() => {
    if (isRef.value && props.uuid) {
      ensure([props.uuid]); // fetch options if uncached
      // Graph walk, so it runs here — once per card open — rather than in a
      // computed that every render would re-evaluate.
      foreignHomes.value = foreignLookup?.(props.uuid) ?? [];
    }
    positionPop(el);
    hoverOpen.value = true;
  }, HOVER_DELAY_MS);
}

function onLeave(): void {
  if (hoverTimer !== undefined) window.clearTimeout(hoverTimer);
  hoverTimer = undefined;
  hoverOpen.value = false;
}

onBeforeUnmount(() => { if (hoverTimer !== undefined) window.clearTimeout(hoverTimer); });
</script>

<template>
  <span
    class="wp-refchip"
    :class="{
      'wp-refchip--var': kind === 'var',
      'wp-refchip--ref': kind === 'ref',
      'wp-refchip--unresolved': !resolved,
      'wp-refchip--filtered': isFiltered,
    }"
    :style="toneStyle"
    :title="filterTitle"
    :data-uuid="uuid || undefined"
    contenteditable="false"
    @click.stop="onClick"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    <i
      v-if="kindIconCls"
      class="wp-refchip__icon wp-refchip__icon--pi"
      :class="kindIconCls"
      aria-hidden="true"
    ></i>
    <span v-else class="wp-refchip__icon" aria-hidden="true">{{ icon }}</span>
    <span class="wp-refchip__label">{{ label }}</span>
    <!-- The pool this ref resolves against came from THIS node's own module
         snapshot, not the library. That changes what the ref will actually
         produce — a node copy can hold different options from the library row
         it was taken from — and until now the only way to find out was to
         open the hover card. The library case is left unmarked: it is the
         default, and marking both turns a signal into decoration. -->
    <i
      v-if="poolFromNode"
      class="pi pi-database wp-refchip__origin"
      data-test="refchip-origin-node"
      aria-hidden="true"
    ></i>
    <!-- Compact filter indicator. The funnel marks "an expression is
         set" (the expression itself stays in the hover title — it can
         be long). A separate ban mark calls out exclude-null so the
         negation reads at a glance. -->
    <span
      v-if="isFiltered"
      class="wp-refchip__filter"
      data-test="refchip-filter"
      aria-hidden="true"
    >
      <i v-if="hasExpr" class="pi pi-filter wp-refchip__funnel"></i>
      <i v-if="showNoNull" class="pi pi-ban wp-refchip__nonull"></i>
    </span>

    <!-- Info-only hover card (issues #3 / #8). The <Teleport> lives INSIDE the
         chip span so the component stays single-root (wrapper.classes/attributes
         keep working); it renders only a placeholder here and moves the card to
         <body> — fixed + pointer-events:none so it escapes overflow + never
         steals the hover. Mirrors the constraint-pair popover. -->
    <Teleport to="body">
    <div
      v-if="hoverOpen"
      class="wp-refchip-pop"
      :class="{ 'wp-refchip-pop--up': popPos.flip }"
      :style="{ top: popPos.top + 'px', left: popPos.left + 'px' }"
      data-test="refchip-hover"
    >
      <template v-if="kind === 'ref'">
        <div class="wp-refchip-pop__head">
          <span v-if="name" class="wp-refchip-pop__name">@{{ name }}</span>
          <span class="wp-refchip-pop__kind">{{ resolved ? moduleKind : "broken" }}</span>
        </div>
        <div class="wp-refchip-pop__uuid">{{ uuid }}</div>
        <div v-if="hasExpr || showNoNull" class="wp-refchip-pop__filter">
          <span v-if="readsAsExpr">{{ readsAsExpr }}</span>
          <span v-if="filter.excludeNull" class="wp-refchip-pop__nonull">null excluded</span>
        </div>
        <!-- Option count only for wildcards (a resolved constraint/derivation
             has no options — don't mislabel it "not in library"). Show the
             not-in-library note ONLY when the ref genuinely didn't resolve. -->
        <div v-if="optionStats" class="wp-refchip-pop__count" data-test="refchip-count">
          {{ hasExpr ? `${optionStats.matched} of ${optionStats.total} options match`
                     : `${optionStats.total} option${optionStats.total === 1 ? "" : "s"}` }}
        </div>
        <!-- Broken ref. The `@{uuid#name}` syntax preserves the name the
             target had when the reference was written, so the card can say
             WHICH module went missing instead of only that something did.
             Stated as "was", because presenting a name we can no longer verify
             as current is how the old card ended up lying. -->
        <template v-else-if="!resolved">
          <div class="wp-refchip-pop__count" data-test="refchip-broken">
            not in the library
          </div>
          <div v-if="name" class="wp-refchip-pop__broken" data-test="refchip-broken-name">
            was “{{ name }}” — deleted, renamed away, or never imported here
          </div>
          <div v-else class="wp-refchip-pop__broken">
            this reference stored no name, so only the id is known
          </div>
          <div class="wp-refchip-pop__broken wp-refchip-pop__broken--fix">
            click the chip to point it at another module
          </div>
        </template>
        <!-- Which pool produced that count. Without it the number is
             unfalsifiable: a node holding a drifted snapshot and the library
             give different answers and both look authoritative. -->
        <div v-if="poolLabel" class="wp-refchip-pop__pool" data-test="refchip-pool">
          {{ poolLabel }}
        </div>
        <div
          v-if="poolDriftNote"
          class="wp-refchip-pop__pool wp-refchip-pop__pool--drift"
          data-test="refchip-pool-drift"
        >{{ poolDriftNote }}</div>
        <div
          v-if="foreignPoolNote"
          class="wp-refchip-pop__pool wp-refchip-pop__pool--foreign"
          data-test="refchip-pool-foreign"
        >{{ foreignPoolNote }}</div>
      </template>
      <template v-else>
        <div class="wp-refchip-pop__head">
          <span class="wp-refchip-pop__name">${{ name }}{{ index != null ? "." + index : "" }}</span>
        </div>
        <!-- Producer attribution. `kind` alone ("came from a wildcard") isn't
             actionable when several near-identical modules bind the same name,
             so the card names the WRITER: its module and the node it sits in.
             Injector rows and loop iteration vars have no module, just a node.
             With no producer info at all the card states that plainly rather
             than implying one exists. -->
        <template v-if="producer">
          <div class="wp-refchip-pop__producer" data-test="refchip-producer">
            <span class="wp-refchip-pop__kind">{{ producerKindLabel }}</span>
            <span v-if="producer.moduleName" class="wp-refchip-pop__producer-name">
              {{ producer.moduleName }}
            </span>
            <span v-if="producer.nodeLabel" class="wp-refchip-pop__producer-node">
              in {{ producer.nodeLabel }}
            </span>
          </div>
          <div v-if="producer.moduleId" class="wp-refchip-pop__uuid">{{ producer.moduleId }}</div>
          <!-- Canvas: runtime is last-write-wins, so name the winner and note
               that earlier writes exist. SPA: no execution order, so the same
               count reads as "N others also bind this" via `siblingLabel`. -->
          <div v-if="producer.shadowed > 0" class="wp-refchip-pop__count">
            {{ siblingText }}
          </div>
          <!-- An internal var resolves downstream but the assembler strips it
               from the rendered prompt — the single most confusing state a var
               can be in, so it is called out. -->
          <div v-if="producer.internal" class="wp-refchip-pop__internal">
            internal — stripped from the final prompt
          </div>
        </template>
        <div v-else-if="inScope" class="wp-refchip-pop__count">in scope</div>
        <div v-else class="wp-refchip-pop__count">
          {{ graphAware ? "no upstream producer — binds at runtime" : "binds at runtime" }}
        </div>
      </template>
    </div>
    </Teleport>
  </span>
</template>

<style scoped>
.wp-refchip {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  padding: 0 5px;
  margin: 1px 1px;
  border-radius: 3px;
  border: 1px solid;
  font: 10px/1.4 var(--wp-font-mono);
  /* Selectable, so a selection that spans the chip actually PAINTS over it.
     With `user-select: none` the browser excluded chips from selection
     rendering: Ctrl+A, or dragging across a value, highlighted the text either
     side and left the chip looking untouched — so the selection appeared to
     stop at the chip even though it included it. Atomicity for EDITING comes
     from `contenteditable="false"` on the element, not from this. */
  user-select: text;
  cursor: default;
  vertical-align: baseline;
}
/* The chip carries its own tint, so the default selection colour can wash it
   out. Painting the highlight explicitly keeps the chip readable while it is
   clearly marked as part of the selection. */
.wp-refchip ::selection,
.wp-refchip::selection {
  background: color-mix(in oklab, var(--wp-accent-500, #8b5cf6) 45%, transparent);
  color: var(--wp-text, #e7e7ee);
}
.wp-refchip--var {
  background: color-mix(in srgb, var(--wp-success, #22c55e) 15%, transparent);
  border-color: color-mix(in srgb, var(--wp-success, #22c55e) 50%, transparent);
  color: var(--wp-success);
}
/* Ref chip tone is sourced from `--wp-refchip-tone` — set per-instance
 * via inline style when `moduleKind` differs from `wildcard`. The
 * fallback to `--wp-kind-wildcard` keeps legacy (no-prop) callers on
 * the original violet palette. */
.wp-refchip--ref {
  background: color-mix(in srgb, var(--wp-refchip-tone, var(--wp-kind-wildcard, #a855f7)) 15%, transparent);
  border-color: color-mix(in srgb, var(--wp-refchip-tone, var(--wp-kind-wildcard, #a855f7)) 50%, transparent);
  color: var(--wp-refchip-tone, var(--wp-kind-wildcard));
  cursor: pointer;
}
.wp-refchip--ref:hover { background: color-mix(in srgb, var(--wp-refchip-tone, var(--wp-kind-wildcard, #a855f7)) 25%, transparent); }
.wp-refchip--unresolved {
  background: color-mix(in srgb, var(--wp-danger, #ef4444) 15%, transparent);
  border-color: color-mix(in srgb, var(--wp-danger, #ef4444) 50%, transparent);
  color: var(--wp-danger);
  cursor: pointer;
}
.wp-refchip--unresolved:hover {
  background: color-mix(in srgb, var(--wp-danger, #ef4444) 25%, transparent);
}
.wp-refchip__icon { font-size: 8px; opacity: 0.75; }
/* PrimeIcon variant (moduleKind set) — sized to align with the unicode glyph baseline. */
.wp-refchip__icon--pi { font-size: 9px; line-height: 1; }
/* Compact filter indicator — funnel (expression set) + optional ban
 * (null excluded). Tinted with the "modified" status accent to read as
 * "this ref is narrowed", and `cursor: help` mirrors the unresolved
 * chip's hover affordance since the full filter lives in the title. */
.wp-refchip__filter {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 1px;
  color: var(--wp-status-modified, #fbbf24);
  cursor: help;
}
/* Node-supplied pool. Deliberately the same hue as the funnel rather than a
   warning colour: this is a fact about where the options come from, not a
   problem. */
.wp-refchip__origin {
  font-size: 8px;
  line-height: 1;
  opacity: 0.8;
  margin-left: 2px; /* audit-exempt: hairline gap after the label */
}
.wp-refchip__funnel { font-size: 8px; line-height: 1; }
.wp-refchip__nonull { font-size: 8px; line-height: 1; opacity: 0.85; }

/* Hover card — teleported to <body>; scoped styles still apply (the data-v
 * attribute travels with the teleported node).
 *
 * Sits ABOVE the popover tier (10020), not level with it: a chip can live
 * INSIDE a popover — a constraint exception's `@ref` chip renders in a Select
 * option row — so its hover card has to clear the menu it is drawn on top of.
 * At 9999 it rendered underneath and was unreadable. */
.wp-refchip-pop {
  position: fixed;
  z-index: 10030;
  width: 260px;
  padding: 7px 9px;
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border-strong);
  border-radius: 7px;
  box-shadow: var(--wp-shadow-lg);
  font: 10px/1.5 var(--wp-font-mono, monospace);
  color: var(--wp-text);
  pointer-events: none;
}
.wp-refchip-pop--up { transform: translateY(-100%); }
.wp-refchip-pop > div { padding: 1px 0; word-break: break-word; }
.wp-refchip-pop__head { display: flex; gap: 6px; align-items: baseline; }
.wp-refchip-pop__name { font-weight: 600; }
.wp-refchip-pop__kind {
  font-size: 8px; text-transform: uppercase;
  color: var(--wp-text-dim);
  border: 1px solid var(--wp-border);
  border-radius: 3px; padding: 0 3px;
}
.wp-refchip-pop__uuid { color: var(--wp-text-muted); }
.wp-refchip-pop__filter { color: var(--wp-text-dim); }
.wp-refchip-pop__count { color: var(--wp-accent-text); font-weight: 600; }
/* Broken-ref detail lines. Danger-toned so the card matches the red chip that
 * opened it — an accent-purple explanation under a red chip reads as ordinary
 * information rather than a fault. */
.wp-refchip-pop__count[data-test="refchip-broken"] {
  color: var(--wp-danger-text, var(--wp-danger, #f87171));
}
.wp-refchip-pop__broken {
  color: var(--wp-text-muted);
  font-weight: 400;
  line-height: 1.45;
  margin-top: 2px;
}
.wp-refchip-pop__broken--fix { color: var(--wp-text-dim); font-style: italic; }
.wp-refchip-pop__nonull { color: var(--wp-status-modified, #fbbf24); margin-left: 4px; }
/* Pool provenance — dimmer than the count it qualifies, since it is context
   for that number rather than a second fact competing with it. */
.wp-refchip-pop__pool {
  color: var(--wp-text-dim);
  font-size: 10.5px;
}
/* The node's snapshot and the library disagree — same amber the drift dot and
   the context-menu "Refresh from library" accent use. */
.wp-refchip-pop__pool--drift { color: var(--wp-status-modified, #fbbf24); }
/* Informational, not a problem — the ref is behaving correctly, the user just
   cannot see why from anywhere else. Info blue rather than the drift amber. */
.wp-refchip-pop__pool--foreign { color: var(--wp-info, #60a5fa); }

/* Producer attribution row — "wildcard · Outfit · in dusk-marten". */
.wp-refchip-pop__producer {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 5px;
}
.wp-refchip-pop__producer-name {
  color: var(--wp-text);
  font-weight: 600;
}
.wp-refchip-pop__producer-node {
  color: var(--wp-text-muted, var(--wp-text2));
  font-family: var(--wp-font-mono);
}
/* Same warning tone the internal/globe toggle uses elsewhere — this is the
   state where a var resolves but contributes nothing to the prompt. */
.wp-refchip-pop__internal {
  color: var(--wp-status-modified, #fbbf24);
  font-weight: 600;
}
</style>
