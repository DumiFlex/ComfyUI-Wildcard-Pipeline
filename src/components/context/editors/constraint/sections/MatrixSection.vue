<script setup lang="ts">
/**
 * Constraint MatrixSection — sub_cat × sub_cat grid.
 *
 * Click any cell → CellRulePopover shows the four state buttons
 * (NEUTRAL / EXCLUDE / BOOST / REDUCE) + a factor input for
 * boost / reduce. State changes commit immediately through
 * `cell_mode_overrides`; factor edits commit through
 * `cell_factor_overrides`. The legacy 5-state click-cycle and
 * the separate cog-anchored factor popover are gone.
 *
 * Lossy-on-read: `mode: "disabled"` collapses into `"neutral"`.
 * Lossy-on-write: any pre-existing `disabled_matrix_cells` entry for
 * a cell the user touches is cleared. The engine already treats all
 * three (`allow` / `disabled` / missing) as runtime passthrough,
 * so the collapse is engine-equivalent.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";
import { encodeKey } from "../../instance/keys";
import { patchInstance } from "../../instance/patch";
import CellRulePopover from "../CellRulePopover.vue";
import MatrixLegend from "../MatrixLegend.vue";
import {
  groupHue as tagHue,
  groupLabel,
  isBucket,
  orderByGroups,
  toGroups,
} from "../../../../shared/matrix-axis";

type Mode = "neutral" | "exclude" | "boost" | "reduce";

interface Cell { mode: Mode; factor: number }

const props = withDefaults(
  defineProps<{
    module: ModuleEntry;
    sourceSubs: readonly string[];
    targetSubs: readonly string[];
    sourceName?: string;
    targetName?: string;
    /** Sub-category axes (tag_groups) of the source/target wildcards. When
     *  present, the matrix orders + colours its rows / cols by axis (bands on
     *  the columns, header chips on the rows) — same treatment as the SPA
     *  ConstraintMatrix. Empty → flat source/target-tinted headers. */
    sourceGroups?: Record<string, string[]>;
    targetGroups?: Record<string, string[]>;
    /** Read-only recovery view: the source/target wildcard was deleted, so
     *  the configured rules are shown for understanding only. Cells don't
     *  open the rule popover; the grid frame + cells mute to a snapshot.
     *  Reattach a live wildcard (banner above) to edit. Mirrors the SPA
     *  ConstraintMatrix `readonly` prop / `wp-mx--readonly` treatment. */
    stranded?: boolean;
  }>(),
  { sourceName: "", targetName: "", sourceGroups: () => ({}), targetGroups: () => ({}), stranded: false },
);
const emit = defineEmits<{ "update": [patch: Partial<ModuleEntry>] }>();

const matrix = computed<Record<string, Record<string, Cell>>>(() => {
  const p = (props.module.payload ?? {}) as { matrix?: Record<string, Record<string, Cell>> };
  return p.matrix ?? {};
});

const instance = computed(() => props.module.instance ?? {});

const disabledCells = computed<Set<string>>(
  () => new Set(instance.value.disabled_matrix_cells ?? []),
);
const cellModeOverrides = computed<Record<string, Mode>>(
  () => (instance.value.cell_mode_overrides as Record<string, Mode> | null) ?? {},
);
const cellFactorOverrides = computed<Record<string, number>>(
  () => (instance.value.cell_factor_overrides as Record<string, number> | null) ?? {},
);

// ── Axis grouping — order + group + colour rows/cols by sub-category axis,
// shared with the SPA ConstraintMatrix via the matrix-axis module. ──
const orderedSources = computed(() => orderByGroups([...props.sourceSubs], props.sourceGroups));
const orderedTargets = computed(() => orderByGroups([...props.targetSubs], props.targetGroups));
const rowGroups = computed(() => toGroups(orderedSources.value));
const colGroups = computed(() => toGroups(orderedTargets.value));
const hasColBands = computed(() => colGroups.value.some((g) => !isBucket(g)));
const hasRowGroups = computed(() => rowGroups.value.some((g) => !isBucket(g)));

// Measure the column band row's height so the tag row beneath it sticks at
// the right `top` offset, independent of font sizing.
const gridEl = ref<HTMLElement | null>(null);
function measureBands(): void {
  const grid = gridEl.value;
  if (!grid) return;
  const band = grid.querySelector<HTMLElement>(".mx-th-band");
  grid.style.setProperty("--mx-band-h", `${band?.offsetHeight ?? 0}px`);
}
watch(colGroups, () => void nextTick(measureBands));

/** Reads `payload.matrix[src][tgt]`. Returns null when no library rule. */
function libCell(src: string, tgt: string): Cell | null {
  const cell = matrix.value[src]?.[tgt];
  if (!cell) return null;
  // Legacy "allow" / "disabled" both fold to neutral on read — the
  // engine never distinguished them at runtime.
  const rawMode = cell.mode as Mode | "allow" | "disabled";
  const mode: Mode = (rawMode === "allow" || rawMode === "disabled") ? "neutral" : rawMode;
  return { mode, factor: cell.factor ?? 1 };
}

/** Effective state for a cell. Override wins; otherwise library;
 *  otherwise neutral. A legacy `disabled_matrix_cells` membership
 *  also reads as neutral — the user will re-mark it via the
 *  popover and any cell they touch gets its disabled entry stripped
 *  by `commitMode()` below. */
function effectiveState(src: string, tgt: string): Mode {
  const key = encodeKey([src, tgt]);
  if (disabledCells.value.has(key)) return "neutral";
  const override = cellModeOverrides.value[key];
  if (override === "neutral" || override === "exclude" || override === "boost" || override === "reduce") {
    return override;
  }
  const lib = libCell(src, tgt);
  return lib ? lib.mode : "neutral";
}

function effectiveFactor(src: string, tgt: string): number {
  const key = encodeKey([src, tgt]);
  const o = cellFactorOverrides.value[key];
  if (typeof o === "number" && Number.isFinite(o)) return o;
  const lib = libCell(src, tgt);
  return lib?.factor ?? 1;
}

function isOverridden(src: string, tgt: string): boolean {
  const key = encodeKey([src, tgt]);
  if (key in cellModeOverrides.value || key in cellFactorOverrides.value) return true;
  // Legacy disabled-set entry also counts as an override for reset purposes
  // — clicking Reset clears it alongside any current override maps.
  return disabledCells.value.has(key);
}

function cellClasses(src: string, tgt: string): string[] {
  const out = ["mx-cell", `s-${effectiveState(src, tgt)}`];
  if (isOverridden(src, tgt)) out.push("mx-cell--mod");
  const open = openPopover.value;
  if (open && open.src === src && open.tgt === tgt) out.push("open");
  return out;
}

function cellGlyph(src: string, tgt: string): string {
  switch (effectiveState(src, tgt)) {
    case "neutral": return "·";
    case "exclude": return "×";
    case "boost":   return "↑";
    case "reduce":  return "↓";
  }
}

function cellShowsFactor(src: string, tgt: string): boolean {
  const s = effectiveState(src, tgt);
  return s === "boost" || s === "reduce";
}

function cellFactorText(src: string, tgt: string): string {
  const f = effectiveFactor(src, tgt);
  return `×${f.toFixed(1)}`;
}

function cellAriaLabel(src: string, tgt: string): string {
  const s = effectiveState(src, tgt);
  const factor = (s === "boost" || s === "reduce") ? ` ×${effectiveFactor(src, tgt).toFixed(1)}` : "";
  // Stranded → the grid is a read-only snapshot, so drop the "Click to
  // edit" affordance from the label (the cell is inert).
  const suffix = props.stranded ? " (read-only)" : ". Click to edit.";
  return `Rule: ${src} → ${tgt}, current state ${s}${factor}${suffix}`;
}

// ── Popover ────────────────────────────────────────────────────
//
// The popover lives in a `<Teleport to="body">` portal so it escapes
// the cell's hover / clipping context entirely. Without teleport the
// popover sits inside `.mx-cell`, which causes two problems:
//   1. Hovering the popover triggers `.mx-cell:hover` on the source
//      cell (transform + glow), making the popover feel like it lives
//      "inside" the cell.
//   2. The cells in the row below (which the popover visually overlaps)
//      receive pointer events because they share a stacking context
//      with the popover's parent — visible to the user as "I can hover
//      cells behind the popover".
// Tracking the cell rect lets us position-fixed the popover at the
// right spot without parenting it inside the table.
const openPopover = ref<{ src: string; tgt: string; left: number; top: number } | null>(null);

function rectForCell(src: string, tgt: string): { left: number; top: number } {
  const el = document.querySelector<HTMLElement>(
    `[data-test="mx-cell-${cssEscape(src)}-${cssEscape(tgt)}"]`,
  );
  if (!el) return { left: 0, top: 0 };
  const r = el.getBoundingClientRect();
  const POP_W = 260;
  const left = Math.min(
    window.innerWidth - POP_W - 12,
    Math.max(12, r.left + r.width / 2 - POP_W / 2),
  );
  const top = r.bottom + 8;
  return { left, top };
}

/** Minimal CSS attribute-value escape so values containing dots or
 *  quotes (sub-category names are user data) don't break the selector. */
function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s);
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

function onCellClick(src: string, tgt: string): void {
  // Read-only recovery view (deleted source/target): cells are inert.
  if (props.stranded) return;
  const open = openPopover.value;
  if (open && open.src === src && open.tgt === tgt) {
    openPopover.value = null;
    return;
  }
  const pos = rectForCell(src, tgt);
  openPopover.value = { src, tgt, left: pos.left, top: pos.top };
}

function closePopover(): void { openPopover.value = null; }

/** Re-position on scroll / resize so the teleported popover tracks its
 *  anchor cell. Closes on the same events if positioning fails. */
function reanchorPopover(): void {
  const cur = openPopover.value;
  if (!cur) return;
  const pos = rectForCell(cur.src, cur.tgt);
  if (pos.left === 0 && pos.top === 0) {
    closePopover();
    return;
  }
  openPopover.value = { ...cur, left: pos.left, top: pos.top };
}

/** Write the override map, stripping the legacy disabled-set entry
 *  for the same cell. Mode defaults: if `next` matches the library
 *  state, drop the override entirely so the override map stays
 *  minimal. */
function commitMode(src: string, tgt: string, next: Mode): void {
  const key = encodeKey([src, tgt]);
  const lib = libCell(src, tgt);
  const libMode: Mode = lib ? lib.mode : "neutral";
  const modeMap = { ...cellModeOverrides.value };
  if (next === libMode) delete modeMap[key];
  else modeMap[key] = next;
  const factorMap = { ...cellFactorOverrides.value };
  // When leaving boost/reduce, drop the factor override too so the
  // cell falls back fully to library / default.
  if (next !== "boost" && next !== "reduce" && key in factorMap) {
    delete factorMap[key];
  }
  // Default factor on entering boost/reduce from a state without one.
  if ((next === "boost" || next === "reduce") && !(key in factorMap)) {
    const libFactor = lib?.factor;
    const isLibFactor = typeof libFactor === "number" && libFactor > 0;
    if (!isLibFactor || (next === "boost" && libFactor < 1.1) || (next === "reduce" && libFactor > 0.9)) {
      factorMap[key] = next === "boost" ? 1.5 : 0.5;
    }
  }
  // Strip the legacy disabled set entry for this cell on every touch
  // — silent migration; the engine treated both as passthrough.
  const dset = new Set(instance.value.disabled_matrix_cells ?? []);
  const dsetChanged = dset.delete(key);
  const inst: Record<string, unknown> = {
    ...(instance.value ?? {}),
    cell_mode_overrides: Object.keys(modeMap).length > 0 ? modeMap : null,
    cell_factor_overrides: Object.keys(factorMap).length > 0 ? factorMap : null,
  };
  if (dsetChanged) {
    inst.disabled_matrix_cells = dset.size === 0 ? null : Array.from(dset);
  }
  emit("update", { instance: inst as ModuleEntry["instance"] });
}

function commitFactor(src: string, tgt: string, factor: number): void {
  if (!Number.isFinite(factor) || factor <= 0) return;
  const key = encodeKey([src, tgt]);
  const lib = libCell(src, tgt);
  const libFactor = lib?.factor;
  const map = { ...cellFactorOverrides.value };
  if (typeof libFactor === "number" && Math.abs(libFactor - factor) < 1e-9) {
    delete map[key];
  } else {
    map[key] = factor;
  }
  emit("update", patchInstance(props.module, "cell_factor_overrides",
    Object.keys(map).length > 0 ? map : null,
  ));
}

/** Reset a cell to its library default — drops both mode and factor
 *  overrides for that key. Also strips any legacy
 *  `disabled_matrix_cells` entry for the same cell. */
function resetCell(src: string, tgt: string): void {
  const key = encodeKey([src, tgt]);
  const modeMap = { ...cellModeOverrides.value };
  const factorMap = { ...cellFactorOverrides.value };
  delete modeMap[key];
  delete factorMap[key];
  const dset = new Set(instance.value.disabled_matrix_cells ?? []);
  const dsetChanged = dset.delete(key);
  const inst: Record<string, unknown> = {
    ...(instance.value ?? {}),
    cell_mode_overrides: Object.keys(modeMap).length > 0 ? modeMap : null,
    cell_factor_overrides: Object.keys(factorMap).length > 0 ? factorMap : null,
  };
  if (dsetChanged) {
    inst.disabled_matrix_cells = dset.size === 0 ? null : Array.from(dset);
  }
  emit("update", { instance: inst as ModuleEntry["instance"] });
}

// ── Outside-click + Escape close ────────────────────────────────
function onDocPointerDown(ev: MouseEvent): void {
  if (openPopover.value === null) return;
  const target = ev.target as HTMLElement | null;
  if (!target) return;
  if (target.closest(".pop")) return;
  if (target.closest(".mx-cell")) return;
  closePopover();
}
function onDocKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Escape" && openPopover.value !== null) {
    ev.preventDefault();
    closePopover();
  }
}
onMounted(() => {
  document.addEventListener("mousedown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeydown);
  window.addEventListener("scroll", reanchorPopover, true);
  window.addEventListener("resize", reanchorPopover);
  window.addEventListener("resize", measureBands);
  void nextTick(measureBands);
});
onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocPointerDown, true);
  document.removeEventListener("keydown", onDocKeydown);
  window.removeEventListener("scroll", reanchorPopover, true);
  window.removeEventListener("resize", reanchorPopover);
  window.removeEventListener("resize", measureBands);
});
</script>

<template>
  <section class="mx" :class="{ 'mx--readonly': stranded }" data-test="mx-section">
    <div class="mx__label-row">
      <div class="mx__label">Rule matrix</div>
      <!-- Stranded ref → the grid is a read-only snapshot, so a lock pill
           replaces the click-to-edit interaction. Reattaching a live
           wildcard (banner above) is the only way back to editing. -->
      <span v-if="stranded" class="mx__lock-pill" data-test="mx-readonly-lock">
        <i class="pi pi-lock" aria-hidden="true" /> Read-only
      </span>
    </div>

    <div class="mx-axes">
      <span class="mx-axis mx-axis--src" data-test="mx-axis-src">
        <span class="arrow" aria-hidden="true">↓</span>
        <span>Source · {{ sourceName || "source" }}</span>
      </span>
      <span class="mx-axis mx-axis--tgt" data-test="mx-axis-tgt">
        <span class="arrow" aria-hidden="true">→</span>
        <span>Target · {{ targetName || "target" }}</span>
      </span>
    </div>

    <div ref="gridEl" class="mx-grid">
      <table>
        <thead>
          <tr>
            <th class="mx-corner" :rowspan="hasColBands ? 2 : 1" data-test="mx-corner">
              <span class="row-1">↓ source</span>
              <span class="row-2">→ target</span>
            </th>
            <!-- Grouped cols: a band row names each axis, spanning its tags. -->
            <template v-if="hasColBands">
              <th
                v-for="(grp, gi) in colGroups"
                :key="`band-${gi}`"
                class="mx-th-band"
                :class="{ 'mx-th-band--bucket': isBucket(grp) }"
                :colspan="grp.tags.length"
                :style="{ '--ax': tagHue(grp, 'target', true) }"
                :title="groupLabel(grp)"
              ><span class="chip">{{ groupLabel(grp) }}</span></th>
            </template>
            <!-- Flat cols: tag headers sit directly in the single header row. -->
            <template v-else>
              <th
                v-for="t in targetSubs"
                :key="t"
                class="mx-th-col"
                :style="{ '--ax': 'var(--wp-constraint-target)' }"
              ><span class="chip">{{ t }}</span></th>
            </template>
          </tr>
          <tr v-if="hasColBands">
            <template v-for="(grp, gi) in colGroups" :key="`coltags-${gi}`">
              <th
                v-for="(t, ti) in grp.tags"
                :key="t"
                class="mx-th-col"
                :class="{ 'group-start': !isBucket(grp) && ti === 0 }"
                :style="{ '--ax': tagHue(grp, 'target', hasColBands) }"
              ><span class="chip">{{ t }}</span></th>
            </template>
          </tr>
        </thead>
        <tbody>
          <template v-for="(grp, gi) in rowGroups" :key="`rowgrp-${gi}`">
            <!-- Header chip: a named multi-tag axis, OR the labelled
                 uncategorized bucket (when the matrix has any named axis). A
                 named solo axis folds into an eyebrow instead (below). -->
            <tr
              v-if="(!isBucket(grp) && grp.tags.length > 1) || (isBucket(grp) && hasRowGroups)"
              class="mx-grp-row"
            >
              <th
                class="mx-grp-head"
                :class="{ 'mx-grp-head--bucket': isBucket(grp) }"
                :colspan="orderedTargets.length + 1"
                :style="{ '--ax': tagHue(grp, 'source', true) }"
                :title="groupLabel(grp)"
              ><span class="chip">{{ groupLabel(grp) }}</span></th>
            </tr>
            <tr v-for="s in grp.tags" :key="s">
              <th
                class="mx-th-row"
                :class="{
                  'group-start': !isBucket(grp) && s === grp.tags[0],
                  solo: !isBucket(grp) && grp.tags.length === 1,
                }"
                :style="{ '--ax': tagHue(grp, 'source', hasRowGroups) }"
              >
                <span v-if="!isBucket(grp) && grp.tags.length === 1" class="chip">
                  <span class="eye">{{ grp.axisName }}</span>
                  <span class="v">{{ s }}</span>
                </span>
                <span v-else class="chip">{{ s }}</span>
              </th>
              <!-- role/tabindex stay static even when stranded (mirrors the
                   SPA ConstraintMatrix): the cell is still a labelled
                   snapshot a screen-reader can land on; `onCellClick` early-
                   returns so it's inert. -->
              <td v-for="t in orderedTargets" :key="`${s}-${t.tag}`" class="mx-td">
                <div
                  :class="cellClasses(s, t.tag)"
                  :data-test="`mx-cell-${s}-${t.tag}`"
                  :aria-label="cellAriaLabel(s, t.tag)"
                  role="button"
                  tabindex="0"
                  @click="onCellClick(s, t.tag)"
                  @keydown.enter.prevent="onCellClick(s, t.tag)"
                  @keydown.space.prevent="onCellClick(s, t.tag)"
                >
                  <span class="glyph">{{ cellGlyph(s, t.tag) }}</span>
                  <span v-if="cellShowsFactor(s, t.tag)" class="factor">{{ cellFactorText(s, t.tag) }}</span>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <p v-if="stranded" class="mx__readonly-hint" data-test="mx-readonly-hint">
      Reattach a live wildcard to edit these rules.
    </p>

    <MatrixLegend />

    <!-- Popover lives in a body-level portal so its hover state stays
         isolated from the source cell, the cells in the row below
         (which it visually overlaps), and any table-level clipping. -->
    <Teleport to="body">
      <div
        v-if="openPopover"
        class="mx-pop-anchor"
        :style="{
          position: 'fixed',
          left: openPopover.left + 'px',
          top: openPopover.top + 'px',
          width: '260px',
          zIndex: 9999,
        }"
        @mousedown.stop
      >
        <CellRulePopover
          :state="effectiveState(openPopover.src, openPopover.tgt)"
          :factor="effectiveFactor(openPopover.src, openPopover.tgt)"
          :src-label="openPopover.src"
          :tgt-label="openPopover.tgt"
          :can-reset="isOverridden(openPopover.src, openPopover.tgt)"
          @update:state="(next) => commitMode(openPopover!.src, openPopover!.tgt, next)"
          @update:factor="(f) => commitFactor(openPopover!.src, openPopover!.tgt, f)"
          @reset="resetCell(openPopover!.src, openPopover!.tgt)"
          @close="closePopover"
        />
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.mx {
  padding: 12px 16px;
  background: var(--wp-bg2);
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
}
.mx__label-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.mx__label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
}
/* Read-only lock pill — mirrors the SPA ConstraintEditor `.cn-lock-pill`
 * (Rule matrix actions when stranded). */
.mx__lock-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: var(--wp-radius, 6px);
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--wp-text-dim, var(--wp-text3));
  background: color-mix(in srgb, var(--wp-text) 4%, transparent);
  border: 1px solid color-mix(in srgb, var(--wp-text) 10%, transparent);
}
.mx__lock-pill .pi { font-size: 9px; }

/* ── Axis tags ─────────────────────────────────────────────── */
.mx-axes {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 10px;
  font: 600 10px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.mx-axis {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 4px;
}
.mx-axis--src {
  color: var(--wp-constraint-source-text);
  background: color-mix(in oklab, var(--wp-constraint-source) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-constraint-source) 35%, transparent);
}
.mx-axis--tgt {
  color: var(--wp-constraint-target-text);
  background: color-mix(in oklab, var(--wp-constraint-target) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-constraint-target) 35%, transparent);
}
.mx-axis .arrow { font: 14px var(--wp-font-mono); line-height: 1; }

/* ── Grid frame — scrolls on BOTH axes; headers + corner freeze ── */
.mx-grid {
  display: inline-block;
  max-width: 100%;
  max-height: 52vh;
  overflow: auto;
  background: var(--wp-bg-deep, #0e1015);
  border: 1px solid var(--wp-border);
  border-radius: 6px;
  padding: 6px;
  vertical-align: top;
}
/* `separate` + zero spacing (NOT `collapse`) — sticky header cells with
 * border-collapse have a Chromium paint bug where scrolled cells bleed through
 * the frozen row/column. The 4px inter-cell gap still comes from th/td padding,
 * so the layout is unchanged. */
.mx-grid table { border-collapse: separate; border-spacing: 0; }
/* 2px cell padding = the 4px inter-cell gap. Sticky headers fill with the
 * OPAQUE grid bg so scrolled cells can't bleed through them. */
.mx-grid th,
.mx-grid td { padding: 2px; vertical-align: middle; }
.mx-grid thead th,
.mx-grid tbody th {
  position: sticky;
  background: var(--wp-bg-deep, #0e1015);
}
.mx-grid thead th { top: 0; z-index: 2; }
.mx-grid tbody th { left: 0; z-index: 1; }
/* Band row pins to the top; the tag row sticks just beneath it (offset = the
 * measured band height). Corner outranks both so it stays in the angle. */
.mx-grid thead th.mx-th-band { top: 0; z-index: 3; }
.mx-grid thead th.mx-th-col { top: var(--mx-band-h, 0px); z-index: 2; }
.mx-grid thead th.mx-corner { top: 0; left: 0; z-index: 5; padding: 5px 8px; }

.mx-corner {
  width: 96px;
  font: 9px var(--wp-font-mono);
  color: var(--wp-text-dim, var(--wp-text3));
  border-radius: 4px;
  text-align: left;
  background: color-mix(in srgb, var(--wp-text) 4%, transparent);
}
.mx-corner .row-1 { display: block; color: var(--wp-constraint-source-text); line-height: 1.3; }
.mx-corner .row-2 { display: block; color: var(--wp-constraint-target-text); line-height: 1.3; }

/* Column band — axis name spanning its tags, atop the tag row. */
.mx-th-band .chip {
  display: flex; align-items: center; justify-content: center;
  height: 22px; padding: 0 8px;
  font: 700 9px var(--wp-font-sans);
  letter-spacing: 0.06em; text-transform: uppercase;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  border-radius: 4px 4px 0 0;
  color: color-mix(in srgb, var(--ax) 82%, var(--wp-text));
  background: color-mix(in srgb, var(--ax) 15%, var(--wp-bg-deep, #0e1015));
  border-bottom: 2px solid color-mix(in srgb, var(--ax) 55%, transparent);
}
.mx-th-band--bucket .chip { border-bottom-style: dashed; }

/* Column tag chip — per-tag header below the band (or the only header row
 * when columns are ungrouped). */
.mx-th-col .chip {
  display: flex; align-items: center; justify-content: center;
  width: 64px; min-height: 28px; padding: 3px 2px;
  font: 700 10px var(--wp-font-sans);
  border-radius: 0 0 4px 4px;
  color: color-mix(in srgb, var(--ax) 72%, var(--wp-text));
  background: color-mix(in srgb, var(--ax) 9%, var(--wp-bg-deep, #0e1015));
}
.mx-th-col.group-start .chip { border-left: 2px solid color-mix(in srgb, var(--ax) 45%, transparent); }

/* Row group header chip — names the axis above its tags, pinned to the left
 * edge so it stays visible during horizontal scroll. The <th> spans the row
 * but stays transparent; only the chip is visible + sticky. */
.mx-grp-row .mx-grp-head {
  position: relative; z-index: 1; background: transparent;
  padding: 4px 0 1px; text-align: left;
}
.mx-grp-head .chip {
  position: sticky; left: 0;
  display: inline-flex; align-items: center;
  max-width: 220px; height: 22px; padding: 0 11px;
  font: 700 9px var(--wp-font-sans);
  letter-spacing: 0.1em; text-transform: uppercase;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  border-radius: 0 4px 4px 0;
  color: color-mix(in srgb, var(--ax) 80%, var(--wp-text));
  background: color-mix(in srgb, var(--ax) 16%, var(--wp-bg-deep, #0e1015));
  border-left: 3px solid var(--ax);
  box-shadow: 0 1px 4px color-mix(in srgb, var(--wp-bg, #000) 55%, transparent);
}
.mx-grp-head--bucket .chip { border-left-style: dashed; }

/* Row tag chip — one per source sub-category, left accent in the axis hue. */
.mx-th-row .chip {
  display: flex; align-items: center; justify-content: flex-start;
  width: 96px; height: 36px; padding: 0 10px;
  font: 700 10px var(--wp-font-sans);
  text-align: left;
  border-radius: 0 4px 4px 0;
  color: color-mix(in srgb, var(--ax) 76%, var(--wp-text));
  background: color-mix(in srgb, var(--ax) 10%, var(--wp-bg-deep, #0e1015));
  border-left: 2px solid color-mix(in srgb, var(--ax) 48%, transparent);
}
.mx-th-row.solo .chip {
  flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px;
  border-left-width: 3px; border-left-color: var(--ax);
}
.mx-th-row.solo .eye {
  max-width: 78px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font: 700 7px var(--wp-font-sans);
  letter-spacing: 0.08em; text-transform: uppercase;
  color: color-mix(in srgb, var(--ax) 72%, var(--wp-text-dim));
}
.mx-th-row.solo .v { font: 600 11px var(--wp-font-sans); color: var(--wp-text); }
.mx-td { position: relative; }

/* ── Body cells ────────────────────────────────────────────── */
.mx-cell {
  width: 64px;
  height: 36px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font: 600 12px var(--wp-font-mono);
  border-radius: 4px;
  cursor: pointer;
  user-select: none;
  transition: transform 0.08s, box-shadow 0.1s, background 0.1s;
  position: relative;
}
.mx-cell:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--wp-text) 22%, transparent),
              0 2px 6px color-mix(in srgb, var(--wp-text) 20%, transparent);
}
.mx-cell.open {
  box-shadow: 0 0 0 2px var(--wp-accent, #c4b5fd),
              0 4px 12px color-mix(in srgb, var(--wp-text) 25%, transparent);
}
.mx-cell.s-neutral {
  background: color-mix(in srgb, var(--wp-text) 4%, transparent);
  color: var(--wp-text-dim, #595c66);
  border: 1px dashed color-mix(in srgb, var(--wp-text) 10%, transparent);
}
.mx-cell.s-exclude {
  background: color-mix(in srgb, var(--wp-danger, #ef4444) 22%, transparent);
  color: var(--wp-danger);
  border: 1px solid color-mix(in srgb, var(--wp-danger, #ef4444) 45%, transparent);
}
.mx-cell.s-boost {
  background: color-mix(in srgb, var(--wp-success, #22c55e) 22%, transparent);
  color: var(--wp-success);
  border: 1px solid color-mix(in srgb, var(--wp-success, #22c55e) 45%, transparent);
}
.mx-cell.s-reduce {
  background: color-mix(in srgb, var(--wp-warn, #f97316) 22%, transparent);
  color: var(--wp-warn);
  border: 1px solid color-mix(in srgb, var(--wp-warn, #f97316) 45%, transparent);
}
.mx-cell--mod {
  outline: 1px dashed var(--wp-status-modified, #fb923c);
  outline-offset: -1px;
}
.glyph { font-size: 14px; line-height: 1; }
.factor { font-size: 11px; font-weight: 700; }

/* ── Read-only recovery view (deleted source/target) ───────────
 *    Mirrors the SPA ConstraintMatrix `wp-mx--readonly`. Cells are
 *    inert: no pointer, no hover lift. The grid frame turns DASHED and
 *    the colored cells drop to ~1/3 of their editable intensity (8% bg /
 *    18% border, text softened toward the dim grey) so the snapshot reads
 *    as "look, don't touch" while the boost/reduce/exclude hues stay
 *    legible. */
.mx--readonly .mx-grid {
  border: 1px dashed color-mix(in srgb, var(--wp-text) 16%, transparent);
}
.mx--readonly .mx-cell { cursor: default; }
.mx--readonly .mx-cell:hover {
  transform: none;
  box-shadow: none;
}
.mx--readonly .mx-cell.s-boost {
  background: color-mix(in srgb, var(--wp-success, #22c55e) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--wp-success, #22c55e) 18%, transparent);
  color: color-mix(in srgb, var(--wp-success, #22c55e) 70%, var(--wp-text-dim));
}
.mx--readonly .mx-cell.s-reduce {
  background: color-mix(in srgb, var(--wp-warn, #f97316) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--wp-warn, #f97316) 18%, transparent);
  color: color-mix(in srgb, var(--wp-warn, #f97316) 70%, var(--wp-text-dim));
}
.mx--readonly .mx-cell.s-exclude {
  background: color-mix(in srgb, var(--wp-danger, #ef4444) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--wp-danger, #ef4444) 18%, transparent);
  color: color-mix(in srgb, var(--wp-danger, #ef4444) 70%, var(--wp-text-dim));
}
.mx__readonly-hint {
  margin: 8px 0 0;
  font: 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}

/* Popover is teleported to body so positioning is handled by inline
 * styles on the anchor wrapper. Nothing extra needed here. */
</style>
