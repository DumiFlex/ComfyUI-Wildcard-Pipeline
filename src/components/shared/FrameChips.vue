<script setup lang="ts">
/**
 * FrameChips — the per-frame chip grid shared by WP_ContextLoop and
 * WP_SeedList.
 *
 * One grid, two jobs, because the two nodes disagree about what a click
 * MEANS. The Loop has an edit cursor, so a plain click selects the frame to
 * edit and the state toggles need modifiers. The Seed List has no cursor and
 * nothing else to do with a chip, so a plain click toggles the lock directly
 * — making people hold Shift for the only available action would be
 * ceremony. `selectable` picks between the two.
 *
 * Bypass is likewise asymmetric. The Loop OWNS its bypass set, so Alt-click
 * toggles it. The Seed List only MIRRORS the bypass of the loop wired into
 * its `loop_config`, so its chips show the state and refuse to change it —
 * editing it here would have to write to a different node.
 *
 * Both states already had a home in the per-iteration seeds modal. Keeping
 * that as the only way to flip one frame meant a round trip through a dialog
 * that covers the node you are reading; the modal stays for what it is
 * actually good at (lock all, paste a series, out-of-range locks).
 */
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    /** Number of frames. Chips are 0-based internally, labelled from 1. */
    count: number;
    /** 0-based locked frame indices. */
    locked?: number[];
    /** 0-based bypassed frame indices. */
    bypassed?: number[];
    /** Selected frame for the edit cursor; `null` is the `base` chip.
     *  Ignored unless `selectable`. */
    current?: number | null;
    /** Plain click selects (Loop) vs toggles the lock (Seed List). */
    selectable?: boolean;
    /** Render the `base` chip. Only the Loop has values every frame inherits. */
    showBase?: boolean;
    /** Alt-click may toggle bypass. False where bypass belongs to another node. */
    bypassInteractive?: boolean;
    /** Section heading. */
    label?: string;
    /** Why bypass cannot be edited here, shown on bypassed chips when
     *  `bypassInteractive` is false. */
    bypassReadonlyHint?: string;
    /** `data-test` namespace, so the two host widgets address their own
     *  chips: `<testId>-base`, `<testId>-1`, `<testId>-2`, … */
    testId?: string;
  }>(),
  {
    locked: () => [],
    bypassed: () => [],
    current: null,
    selectable: false,
    showBase: false,
    bypassInteractive: false,
    label: "frames",
    bypassReadonlyHint: "",
    testId: "loop-frame",
  },
);

const emit = defineEmits<{
  select: [index: number | null];
  toggleLock: [index: number];
  toggleBypass: [index: number];
}>();

/**
 * Collapse state, persisted by the host.
 *
 * `defineModel` so this works both ways: bound, the widget glue owns the value
 * and writes it to `node.properties` (the workflow-JSON serialization root, and
 * the only place per-node UI state survives a save); unbound, it falls back to
 * a local ref, which is what keeps the component usable standalone.
 *
 * The risk a persisted collapse carries is someone forgetting a frame is
 * locked behind a grid that stays hidden across sessions. That is why the
 * header keeps reporting counts while collapsed — see `summary`.
 */
const collapsed = defineModel<boolean>("collapsed", { default: false });

const frames = computed(() =>
  Array.from({ length: Math.max(1, props.count) }, (_, i) => i),
);
const lockedSet = computed(() => new Set(props.locked));
const bypassedSet = computed(() => new Set(props.bypassed));

/** In-range counts only — an out-of-range lock is the modal's business, and
 *  claiming it here would name a frame that has no chip. */
const lockedInRange = computed(() => frames.value.filter((i) => lockedSet.value.has(i)).length);
const bypassedInRange = computed(() => frames.value.filter((i) => bypassedSet.value.has(i)).length);

/** Collapsed summary — the whole point of collapsing is to hide the grid, so
 *  the header has to keep saying whether anything is set. */
const summary = computed(() => {
  const bits: string[] = [];
  if (lockedInRange.value) bits.push(`${lockedInRange.value} locked`);
  if (bypassedInRange.value) bits.push(`${bypassedInRange.value} bypassed`);
  return bits.join(" · ");
});

/** Option on a Mac keyboard, Alt everywhere else. `altKey` covers both; only
 *  the printed label differs. */
const ALT_LABEL =
  typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/i.test(navigator.userAgent)
    ? "⌥"
    : "Alt";

function onChipClick(i: number, ev: MouseEvent): void {
  if (ev.altKey) {
    if (props.bypassInteractive) emit("toggleBypass", i);
    return;
  }
  if (!props.selectable) {
    // No cursor to move: the plain click IS the lock toggle.
    emit("toggleLock", i);
    return;
  }
  if (ev.shiftKey) { emit("toggleLock", i); return; }
  emit("select", i);
}

function chipTitle(i: number): string {
  const state = [
    lockedSet.value.has(i) ? "seed locked" : null,
    bypassedSet.value.has(i) ? "bypassed" : null,
  ].filter(Boolean).join(", ");
  const lines = [`Frame ${i + 1}${state ? ` — ${state}` : ""}`];
  const lockVerb = lockedSet.value.has(i) ? "Unlock" : "Lock";
  if (props.selectable) {
    lines.push("Click to edit this frame", `Shift-click to ${lockVerb.toLowerCase()} its seed`);
  } else {
    lines.push(`Click to ${lockVerb.toLowerCase()} its seed`);
  }
  if (props.bypassInteractive) {
    lines.push(`${ALT_LABEL}-click to ${bypassedSet.value.has(i) ? "re-enable" : "bypass"} it`);
  } else if (bypassedSet.value.has(i) && props.bypassReadonlyHint) {
    lines.push(props.bypassReadonlyHint);
  }
  return lines.join("\n");
}

/**
 * `data-test` root for the chrome (toggle / summary / grid / hint).
 *
 * Pluralised so it does NOT collide with the chips' own `${testId}-` prefix —
 * suites count chips with `[data-test^="loop-frame-"]`, and a sibling named
 * `loop-frame-hint` silently inflates that count.
 */
const uiId = computed(() => `${props.testId}s`);

/** The combos, printed. An undiscoverable shortcut is the same as no
 *  shortcut, and this row is where the reader is already looking. */
const hint = computed(() => {
  if (!props.selectable) return "Click a frame to lock its seed";
  return `Shift-click locks a seed · ${ALT_LABEL}-click bypasses`;
});
</script>

<template>
  <div class="wp-fchips">
    <button
      type="button"
      class="wp-fchips__head"
      :aria-expanded="!collapsed"
      :data-test="`${uiId}-toggle`"
      :title="collapsed ? 'Show frames' : 'Hide frames'"
      @click="collapsed = !collapsed"
    >
      <svg
        class="wp-fchips__caret"
        :class="{ 'wp-fchips__caret--collapsed': collapsed }"
        width="9" height="9" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"
        aria-hidden="true"
      ><path d="M6 9l6 6 6-6" /></svg>
      <span class="wp-fchips__label">{{ label }}</span>
      <span
        v-if="summary"
        class="wp-fchips__summary"
        :data-test="`${uiId}-summary`"
      >{{ summary }}</span>
    </button>

    <template v-if="!collapsed">
      <!-- `overflow-y: auto` + a bounded height is what makes a 100-frame loop
           survivable. The wheel shield installed on every widget host lets the
           wheel scroll this instead of zooming the canvas under Nodes 2.0. -->
      <div
        class="wp-fchips__grid"
        :role="selectable ? 'radiogroup' : 'group'"
        :aria-label="label"
        :data-test="`${uiId}-grid`"
      >
        <button
          v-if="showBase"
          type="button"
          class="wp-fchips__chip"
          :class="{ 'wp-fchips__chip--active': current === null }"
          :data-test="`${testId}-base`"
          role="radio"
          :aria-checked="current === null"
          title="Edit the values every frame inherits"
          @click="emit('select', null)"
        >base</button>

        <button
          v-for="i in frames"
          :key="i"
          type="button"
          class="wp-fchips__chip"
          :class="{
            'wp-fchips__chip--active': selectable && current === i,
            'wp-fchips__chip--locked': lockedSet.has(i),
            'wp-fchips__chip--bypassed': bypassedSet.has(i),
          }"
          :data-test="`${testId}-${i + 1}`"
          :role="selectable ? 'radio' : undefined"
          :aria-checked="selectable ? current === i : undefined"
          :aria-pressed="selectable ? undefined : lockedSet.has(i)"
          :data-locked="lockedSet.has(i) ? 'true' : undefined"
          :data-bypassed="bypassedSet.has(i) ? 'true' : undefined"
          :title="chipTitle(i)"
          @click="onChipClick(i, $event)"
        >#{{ i + 1 }}</button>
      </div>
      <p class="wp-fchips__hint" :data-test="`${uiId}-hint`">{{ hint }}</p>
    </template>
  </div>
</template>

<style scoped>
@import "./theme.css";

.wp-fchips { display: flex; flex-direction: column; gap: 4px; }

.wp-fchips__head {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 0;
  background: none;
  border: 0;
  cursor: pointer;
  text-align: left;
  color: var(--wp-text-dim, var(--wp-text-muted, #8a8d99));
}
.wp-fchips__head:hover { color: var(--wp-text-muted, #aeb1bb); }
.wp-fchips__caret { flex: none; transition: transform var(--wp-motion-hover, 120ms) ease; }
.wp-fchips__caret--collapsed { transform: rotate(-90deg); }
.wp-fchips__label {
  font: 600 9px var(--wp-font-sans, sans-serif);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
/* Kept visible while collapsed — hiding the grid must not also hide the fact
 * that frames are locked or bypassed. */
.wp-fchips__summary {
  margin-left: auto;
  font: 600 8px var(--wp-font-sans, sans-serif);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  border-radius: 3px;
  color: var(--wp-accent-text, var(--wp-text));
  background: rgba(99, 102, 241, 0.14);
  border: 1px solid color-mix(in srgb, var(--wp-accent, #c4b5fd) 40%, transparent);
}

/* auto-fill keeps a uniform cell width so 15+ chips WRAP instead of
 * overflowing the node; the bounded height then caps how much of the node
 * a long series can claim. ~4 rows before it scrolls. */
.wp-fchips__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(38px, 1fr));
  gap: 4px;
  max-height: var(--wp-fchips-max-h, 112px);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--wp-scrollbar-thumb, rgba(255, 255, 255, 0.28)) transparent;
  /* Room for the scrollbar so the last column is never sat on. */
  padding-right: 2px;
}
.wp-fchips__grid::-webkit-scrollbar { width: 8px; }
.wp-fchips__grid::-webkit-scrollbar-track { background: transparent; }
.wp-fchips__grid::-webkit-scrollbar-thumb {
  background: var(--wp-scrollbar-thumb, rgba(255, 255, 255, 0.28));
  border-radius: 999px;
}

.wp-fchips__chip {
  /* Not `flex: 1` — the grid owns the track sizing, and a flex hint here
   * fights it. */
  position: relative;
  padding: 4px 6px;
  text-align: center;
  background: var(--wp-bg-deep, var(--wp-bg, #0e1015));
  border: 1px solid var(--wp-border, #353841);
  border-radius: 3px;
  color: var(--wp-text-muted, #aeb1bb);
  font: 600 10px var(--wp-font-sans, sans-serif);
  cursor: pointer;
}
.wp-fchips__chip:hover { color: var(--wp-text); border-color: var(--wp-border-strong, #4a4d55); }
.wp-fchips__chip--active {
  background: color-mix(in srgb, var(--wp-accent, #c4b5fd) 18%, transparent);
  border-color: var(--wp-accent, #c4b5fd);
  color: var(--wp-accent, #c4b5fd);
}
/* Bypassed — interrupted (dashed) border + dimmed, so it reads at a glance.
 * Composes with --active (dashed overrides the solid). */
.wp-fchips__chip--bypassed {
  border-style: dashed;
  border-color: var(--wp-border-strong, #4a4d55);
  opacity: 0.5;
}
.wp-fchips__chip--bypassed:hover { opacity: 0.8; }
/* Locked — a corner dot. At ~20px tall a padlock glyph would be mud; the dot
 * only has to say "something is pinned here" and the tooltip carries the
 * value. Every chip is position:relative, so toggling never reflows the grid. */
.wp-fchips__chip--locked::after {
  content: "";
  position: absolute;
  top: 2px;
  right: 2px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--wp-accent, #c4b5fd);
}
/* A bypassed frame keeps its lock, and the dot must survive the dim — else
 * unlocking it later looks like it did nothing. */
.wp-fchips__chip--bypassed.wp-fchips__chip--locked::after { opacity: 0.9; }

.wp-fchips__hint {
  margin: 1px 0 0;
  font: 400 9px var(--wp-font-sans, sans-serif);
  color: var(--wp-text-dim, var(--wp-text-muted, #8a8d99));
}
</style>
