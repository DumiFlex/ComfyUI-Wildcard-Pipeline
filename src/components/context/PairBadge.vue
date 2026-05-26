<script setup lang="ts">
/**
 * PairBadge — single source of truth for the four constraint-pair chip
 * surfaces:
 *
 *   - `sender`   : the constraint module's badge. Renders `#N` plus a
 *     trailing `↪` glyph when `pair.via` is set (target reached via a
 *     nested ref). Shows a leading `!` when orphan.
 *   - `direct`   : the badge attached to a directly-claimed downstream
 *     target wildcard row. Plain `#N`.
 *   - `carrier`  : the `↪×N` collapsed solid chip rendered on a wildcard
 *     module row whose options host the nested `@{uuid}` ref(s) one or
 *     more constraints reach their target through. Aggregates ALL inbound
 *     via-pairs into a single chip so a wildcard routing several
 *     constraints doesn't sprawl into N chips. Color matches the (single)
 *     target uuid when uniform, falls back to a neutral surface when the
 *     inbound pairs target different uuids.
 *   - `option`   : the trailing `↪#N` chip inside one specific option
 *     row of the wildcard's edit modal — narrower scope than `carrier`
 *     because it only renders on the rows whose `value` actually
 *     carries the ref. One chip per pair is fine here since the per-
 *     option scope already caps the count.
 *
 * Self-contained popover: hover or click the chip → reveals a small
 * card describing the pair (or list of pairs for the collapsed carrier
 * variant). Replaces the per-surface `title` attribute tooltips so the
 * affordance is consistent + uses the colored palette.
 *
 * Popover positioning: viewport-anchored via `position: fixed` + a
 * Teleport to `body`, so the chip's clipping parent (ModuleRow's
 * `overflow:hidden` cards, the wildcard modal's scrollable pool table)
 * doesn't cut it off.
 */
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import type { PairingBadge } from "../../extension/constraint-pairs";
import { cacheVersion, ensure, lookup } from "../../extension/preview-resolver";

type Variant = "sender" | "direct" | "carrier" | "option";

const props = defineProps<{
  /** Single-pair variants (sender / direct / option / carrier-with-1) — the
   *  one pair this chip represents. Carrier variant accepts the array
   *  form via `pairs` instead. */
  pair?: PairingBadge;
  /** Multi-pair carrier variant — aggregate inbound via-pairs collapsed
   *  into one `↪×N` chip. Ignored for non-carrier variants. */
  pairs?: readonly PairingBadge[];
  variant: Variant;
}>();

/** Resolve the list of pairs this chip represents. Carrier may receive
 *  a list (collapsed) or a single (legacy / single-inbound). Other
 *  variants always single. */
const pairList = computed<readonly PairingBadge[]>(() => {
  if (props.variant === "carrier") {
    if (props.pairs && props.pairs.length > 0) return props.pairs;
    if (props.pair) return [props.pair];
    return [];
  }
  return props.pair ? [props.pair] : [];
});

const primaryPair = computed<PairingBadge | null>(
  () => pairList.value[0] ?? null,
);

/** Chip is multi-color when carrier collapses pairs targeting DIFFERENT
 *  uuids — falls back to a neutral surface so no single target's hue
 *  "claims" the chip. */
const isMultiColor = computed<boolean>(() => {
  if (props.variant !== "carrier") return false;
  if (pairList.value.length < 2) return false;
  const first = pairList.value[0].colorIndex;
  return pairList.value.some((p) => p.colorIndex !== first);
});

/** Eagerly request preview-resolver entries for every target uuid in
 *  the list so the popover can render names on second open. */
ensure(pairList.value.map((p) => p.targetUuid));

const open = ref<boolean>(false);
const chipRef = ref<HTMLElement | null>(null);
const popoverStyle = ref<Record<string, string>>({});

/** Lookup target's display name from the preview-resolver cache, reading
 *  `cacheVersion.value` to subscribe to lazy-fetch completions. Returns
 *  `null` when no name available yet — popover then falls back to the
 *  uuid alone. */
function nameForUuid(uuid: string): string | null {
  void cacheVersion.value;
  const hit = lookup(uuid);
  if (!hit) return null;
  return hit.varBinding?.trim() || hit.name?.trim() || null;
}

/** Place the popover above the chip when there's room, below otherwise.
 *  Right-edge clamped to viewport so a chip near the right edge of the
 *  card doesn't push the popover off-screen. */
function positionPopover(): void {
  const el = chipRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const POP_W = 280;
  const PAD = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fitsAbove = rect.top > 180;
  const top = fitsAbove ? rect.top - PAD : rect.bottom + PAD;
  let left = rect.left + rect.width / 2 - POP_W / 2;
  if (left < 8) left = 8;
  if (left + POP_W > vw - 8) left = vw - POP_W - 8;
  popoverStyle.value = {
    top: `${Math.max(8, Math.min(vh - 8, top))}px`,
    left: `${left}px`,
    transform: fitsAbove ? "translateY(-100%)" : "none",
  };
}

let hoverCloseTimer: number | null = null;

function onEnter(): void {
  if (hoverCloseTimer !== null) {
    window.clearTimeout(hoverCloseTimer);
    hoverCloseTimer = null;
  }
  open.value = true;
  void nextTick(positionPopover);
}

function onLeave(): void {
  hoverCloseTimer = window.setTimeout(() => {
    open.value = false;
    hoverCloseTimer = null;
  }, 120);
}

function onClickChip(): void {
  open.value = !open.value;
  if (open.value) void nextTick(positionPopover);
}

onBeforeUnmount(() => {
  if (hoverCloseTimer !== null) window.clearTimeout(hoverCloseTimer);
});

/** Route label per-pair, with carrier context when the route goes
 *  through a nested ref. Variant flips the framing:
 *    - sender chip (on the constraint module) → "Via nested ref in
 *      @backdrop" (points at the carrier that hosts the ref).
 *    - carrier / option chip (on the carrier itself) → "Via this
 *      wildcard's nested ref" (the user is already looking AT the
 *      carrier; no need to repeat its name).
 *    - direct / no-via → "Direct downstream target". */
/** Route label per-pair, framed by variant:
 *    - sender chip (constraint module) → "Via nested ref in @backdrop"
 *      (points at the carrier hosting the ref).
 *    - carrier chip (the wildcard row itself) → "Via this wildcard's
 *      nested ref" (user is already on the carrier).
 *    - option chip (inside the wildcard modal's option row) → "Via this
 *      option's nested ref".
 *    - direct / no-via → "Direct downstream target". */
function routeLabel(p: PairingBadge): string {
  if (p.isOrphan) return "Orphan — no downstream target instance";
  if (!p.via) return "Direct downstream target";
  if (props.variant === "sender") {
    const name = p.via.carrierName?.trim();
    return name ? `Via nested ref in @${name}` : "Via nested ref";
  }
  if (props.variant === "option") return "Via this option's nested ref";
  return "Via this wildcard's nested ref";
}

const chipClasses = computed<string[]>(() => {
  const cls = ["wp-pair-badge"];
  if (isMultiColor.value) {
    cls.push("wp-pair-badge--via-multi");
  } else if (primaryPair.value) {
    cls.push(`wp-pair-badge--c${primaryPair.value.colorIndex}`);
  }
  if (props.variant === "carrier" || props.variant === "option") {
    cls.push("wp-pair-badge--via-carrier");
  }
  if (
    props.variant !== "carrier"
    && primaryPair.value?.isOrphan
  ) {
    cls.push("wp-pair-badge--orphan");
  }
  if (
    props.variant === "sender"
    && primaryPair.value?.via
  ) {
    cls.push("wp-pair-badge--via");
  }
  return cls;
});

/** Carrier chip text. Uses `↪ ×N` (note the space separating the arrow
 *  from the multiplier) for the collapsed form. The space avoids the
 *  ligature-like blur some monospace fonts produce when `↪` butts up
 *  against `×`, and keeps the glyph readable at chip-size. */
const carrierText = computed<string>(() => `↪ ×${pairList.value.length}`);

const popoverAriaLabel = computed<string>(() => {
  if (props.variant === "carrier") {
    return `${pairList.value.length} constraint pair${pairList.value.length === 1 ? "" : "s"} via nested refs`;
  }
  return primaryPair.value
    ? `Constraint pair ${primaryPair.value.number}`
    : "Constraint pair";
});
</script>

<template>
  <span
    v-if="pairList.length > 0"
    ref="chipRef"
    :class="chipClasses"
    tabindex="0"
    role="button"
    :aria-label="popoverAriaLabel"
    :aria-expanded="open"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @focus="onEnter"
    @blur="onLeave"
    @click.stop="onClickChip"
    @keydown.enter.prevent="onClickChip"
    @keydown.space.prevent="onClickChip"
  >
    <template v-if="variant === 'sender' || variant === 'direct'">
      <span v-if="primaryPair?.isOrphan" class="wp-pair-badge__warn">!</span>
      <template v-if="variant === 'sender' && primaryPair?.via">#{{ primaryPair.number }} ↪</template>
      <template v-else>#{{ primaryPair?.number }}</template>
    </template>
    <template v-else-if="variant === 'carrier'">
      {{ carrierText }}
    </template>
    <template v-else>
      ↪#{{ primaryPair?.number }}
    </template>
  </span>

  <Teleport to="body">
    <div
      v-if="open && pairList.length > 0"
      class="wp-pair-pop"
      :class="!isMultiColor && primaryPair ? `wp-pair-pop--c${primaryPair.colorIndex}` : null"
      :style="popoverStyle"
      role="tooltip"
      @mouseenter="onEnter"
      @mouseleave="onLeave"
    >
      <div class="wp-pair-pop__head">
        <span v-if="variant === 'carrier' && pairList.length > 1" class="wp-pair-pop__num">×{{ pairList.length }}</span>
        <span v-else-if="primaryPair" class="wp-pair-pop__num">#{{ primaryPair.number }}</span>
        <span class="wp-pair-pop__title">
          {{ variant === "carrier" && pairList.length > 1 ? "Routed constraint pairs" : "Constraint pair" }}
        </span>
      </div>
      <div
        v-for="(p, i) in pairList"
        :key="`${p.number}-${p.targetUuid}-${i}`"
        class="wp-pair-pop__entry"
        :class="`wp-pair-pop__entry--c${p.colorIndex}`"
      >
        <div v-if="variant === 'carrier' && pairList.length > 1" class="wp-pair-pop__entry-head">
          <span class="wp-pair-pop__entry-num">#{{ p.number }}</span>
        </div>
        <div class="wp-pair-pop__row">
          <span class="wp-pair-pop__lbl">Route</span>
          <span class="wp-pair-pop__val">{{ routeLabel(p) }}</span>
        </div>
        <div class="wp-pair-pop__row">
          <span class="wp-pair-pop__lbl">Target</span>
          <span class="wp-pair-pop__val">
            <span v-if="nameForUuid(p.targetUuid)">@{{ nameForUuid(p.targetUuid) }}</span>
            <span class="wp-pair-pop__uuid">{{ p.targetUuid }}</span>
          </span>
        </div>
        <div v-if="p.via && (p.via.optionIds?.length ?? 0) > 0" class="wp-pair-pop__row">
          <span class="wp-pair-pop__lbl">Option{{ (p.via.optionIds?.length ?? 0) > 1 ? "s" : "" }}</span>
          <span class="wp-pair-pop__val wp-pair-pop__optids">
            <span v-for="id in (p.via.optionIds ?? [])" :key="id" class="wp-pair-pop__pill">{{ id }}</span>
          </span>
        </div>
      </div>
      <div v-if="pairList.length === 1" class="wp-pair-pop__hint">
        <template v-if="primaryPair?.isOrphan">
          No matching downstream wildcard exists. Add an instance to satisfy this constraint.
        </template>
        <template v-else-if="primaryPair?.via">
          The constraint fires when this wildcard rolls an option whose value contains the nested ref.
        </template>
        <template v-else>
          The constraint claims the next downstream wildcard instance with this uuid.
        </template>
      </div>
      <div v-else class="wp-pair-pop__hint">
        Each constraint fires when this wildcard rolls an option carrying its target ref.
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Chip styling lives in shared/theme.css (wp-pair-badge + palette) so
 * all four variants pick up the same colors as the older inline chips
 * — this component only owns the popover surface + focus ring. */
.wp-pair-badge { cursor: pointer; }
.wp-pair-badge:focus { outline: 2px solid currentColor; outline-offset: 1px; }

.wp-pair-pop {
  position: fixed;
  z-index: 9999;
  width: 280px;
  padding: 8px 10px;
  background: var(--wp-bg-1, var(--wp-bg2, #1a1d24));
  border: 1px solid var(--wp-border-strong, var(--wp-border, #353841));
  border-radius: 5px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.5);
  font: 11px var(--wp-font-sans, sans-serif);
  color: var(--wp-text, #e0e0e8);
  pointer-events: auto;
}
.wp-pair-pop__head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--wp-border, #2a2d35);
}
.wp-pair-pop__num {
  font: 600 11px var(--wp-font-mono, monospace);
  padding: 1px 6px;
  border-radius: 3px;
  background: color-mix(in srgb, currentColor 14%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
}
.wp-pair-pop__title {
  font: 600 9px var(--wp-font-sans, sans-serif);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--wp-text-dim, var(--wp-text-muted, #8a8d99));
}
.wp-pair-pop__entry + .wp-pair-pop__entry {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--wp-border, #2a2d35);
}
.wp-pair-pop__entry-head {
  margin-bottom: 4px;
}
.wp-pair-pop__entry-num {
  font: 600 10px var(--wp-font-mono, monospace);
  padding: 1px 5px;
  border-radius: 3px;
  background: color-mix(in srgb, currentColor 14%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
  color: currentColor;
}
.wp-pair-pop__entry--c1 .wp-pair-pop__entry-num { color: var(--wp-var-1); }
.wp-pair-pop__entry--c2 .wp-pair-pop__entry-num { color: var(--wp-var-2); }
.wp-pair-pop__entry--c3 .wp-pair-pop__entry-num { color: var(--wp-var-3); }
.wp-pair-pop__entry--c4 .wp-pair-pop__entry-num { color: var(--wp-var-4); }
.wp-pair-pop__entry--c5 .wp-pair-pop__entry-num { color: var(--wp-var-5); }
.wp-pair-pop__entry--c6 .wp-pair-pop__entry-num { color: var(--wp-var-6); }
.wp-pair-pop__entry--c7 .wp-pair-pop__entry-num { color: var(--wp-var-7); }
.wp-pair-pop__entry--c8 .wp-pair-pop__entry-num { color: var(--wp-var-8); }
.wp-pair-pop__row {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
  align-items: baseline;
}
.wp-pair-pop__lbl {
  flex: 0 0 50px;
  font: 600 9px var(--wp-font-sans, sans-serif);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--wp-text-dim, var(--wp-text-muted, #8a8d99));
}
.wp-pair-pop__val {
  flex: 1;
  font: 11px var(--wp-font-mono, monospace);
  color: var(--wp-text, #e0e0e8);
  word-break: break-word;
}
.wp-pair-pop__uuid {
  display: block;
  font: 9px var(--wp-font-mono, monospace);
  color: var(--wp-text-dim, #7a7d88);
  margin-top: 1px;
}
.wp-pair-pop__optids { display: flex; flex-wrap: wrap; gap: 3px; }
.wp-pair-pop__pill {
  font: 9px var(--wp-font-mono, monospace);
  padding: 1px 5px;
  background: color-mix(in srgb, currentColor 10%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 3px;
  color: var(--wp-text-muted, #aeb1bb);
}
.wp-pair-pop__hint {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--wp-border, #2a2d35);
  font: 10px var(--wp-font-sans, sans-serif);
  color: var(--wp-text-dim, var(--wp-text-muted, #8a8d99));
  line-height: 1.4;
}

/* Color-band the head badge color to match the chip. */
.wp-pair-pop--c1 .wp-pair-pop__num { color: var(--wp-var-1); }
.wp-pair-pop--c2 .wp-pair-pop__num { color: var(--wp-var-2); }
.wp-pair-pop--c3 .wp-pair-pop__num { color: var(--wp-var-3); }
.wp-pair-pop--c4 .wp-pair-pop__num { color: var(--wp-var-4); }
.wp-pair-pop--c5 .wp-pair-pop__num { color: var(--wp-var-5); }
.wp-pair-pop--c6 .wp-pair-pop__num { color: var(--wp-var-6); }
.wp-pair-pop--c7 .wp-pair-pop__num { color: var(--wp-var-7); }
.wp-pair-pop--c8 .wp-pair-pop__num { color: var(--wp-var-8); }
</style>
