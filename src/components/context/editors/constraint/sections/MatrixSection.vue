<script setup lang="ts">
/**
 * Constraint MatrixSection — sub_cat × sub_cat grid with cycle+cog
 * interaction per the 2026-05-10 v2 modal spec.
 *
 * Cell click cycles: allow → exclude → boost → reduce → disabled → allow.
 * "disabled" state writes to `disabled_matrix_cells`; cycling away
 * removes the key. Mode/factor overrides are NOT cleared when disabling
 * — they persist and reapply when user cycles back.
 *
 * Cog icon visible only on boost/reduce cells (factor matters there).
 * Click cog → CellFactorPopover anchored to cell. Popover writes to
 * `cell_factor_overrides`; ↺ reset deletes the key.
 *
 * Override marker (orange dashed border) appears when cell mode OR
 * factor differs from library value.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ModuleEntry } from "../../../../../widgets/_shared";
import { encodeKey } from "../../instance/keys";
import { patchInstance } from "../../instance/patch";
import CellFactorPopover from "../CellFactorPopover.vue";

type Mode = "allow" | "exclude" | "boost" | "reduce";

interface Cell { mode: Mode; factor: number }

const props = withDefaults(
  defineProps<{
    module: ModuleEntry;
    sourceSubs: readonly string[];
    targetSubs: readonly string[];
    /** Display name of the source/target wildcards — shown in the
     *  matrix corner so users know which wildcards the rules govern.
     *  Falls back to "source"/"target" when not provided. */
    sourceName?: string;
    targetName?: string;
  }>(),
  { sourceName: "", targetName: "" },
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

function libCell(src: string, tgt: string): Cell | null {
  const cell = matrix.value[src]?.[tgt];
  return cell ? { mode: cell.mode, factor: cell.factor } : null;
}

function effectiveMode(src: string, tgt: string): Mode | "disabled" | null {
  const key = encodeKey([src, tgt]);
  if (disabledCells.value.has(key)) return "disabled";
  const lib = libCell(src, tgt);
  if (!lib) return null;
  return cellModeOverrides.value[key] ?? lib.mode;
}

function effectiveFactor(src: string, tgt: string): number | null {
  const lib = libCell(src, tgt);
  if (!lib) return null;
  const key = encodeKey([src, tgt]);
  return cellFactorOverrides.value[key] ?? lib.factor;
}

function isOverridden(src: string, tgt: string): boolean {
  const key = encodeKey([src, tgt]);
  return key in cellModeOverrides.value || key in cellFactorOverrides.value;
}

function cellClass(src: string, tgt: string): string[] {
  const classes = ["mx__cell"];
  const lib = libCell(src, tgt);
  if (!lib) {
    classes.push("mx__cell--empty");
    return classes;
  }
  const mode = effectiveMode(src, tgt);
  if (mode === "disabled") classes.push("mx__cell--disabled");
  else if (mode) classes.push(`mx__cell--${mode}`);
  if (isOverridden(src, tgt)) classes.push("mx__cell--overridden");
  return classes;
}

const CYCLE: Record<Mode | "disabled", Mode | "disabled"> = {
  allow: "exclude",
  exclude: "boost",
  boost: "reduce",
  reduce: "disabled",
  disabled: "allow",
};

function onCellClick(src: string, tgt: string): void {
  const lib = libCell(src, tgt);
  if (!lib) return;
  const key = encodeKey([src, tgt]);
  const current = effectiveMode(src, tgt) ?? "allow";
  const next = CYCLE[current];

  // Build the next instance patch in two phases: handle disabled set,
  // then handle mode override map. Factor override is preserved
  // throughout (intentional — user keeps tweaks across disable toggles).
  const inst: Record<string, unknown> = { ...(instance.value ?? {}) };

  // Disabled set update
  if (next === "disabled") {
    const set = new Set(instance.value.disabled_matrix_cells ?? []);
    set.add(key);
    inst.disabled_matrix_cells = Array.from(set);
  } else if (current === "disabled") {
    const set = new Set(instance.value.disabled_matrix_cells ?? []);
    set.delete(key);
    inst.disabled_matrix_cells = set.size === 0 ? null : Array.from(set);
  }

  // Mode override update (only when next is a real mode, not "disabled")
  if (next !== "disabled") {
    const map = { ...cellModeOverrides.value };
    if (next === lib.mode) {
      delete map[key];
    } else {
      map[key] = next as Mode;
    }
    inst.cell_mode_overrides = Object.keys(map).length > 0 ? map : null;
  }

  emit("update", { instance: inst as ModuleEntry["instance"] });
}

// ── Cog popover ────────────────────────────────────────────────────

const popoverFor = ref<{ src: string; tgt: string } | null>(null);

function isPopoverOpen(src: string, tgt: string): boolean {
  return popoverFor.value?.src === src && popoverFor.value?.tgt === tgt;
}

function onCogClick(src: string, tgt: string, ev: Event): void {
  ev.stopPropagation();
  popoverFor.value = { src, tgt };
}

function closePopover(): void {
  popoverFor.value = null;
}

// Outside-click + Escape close. Uses capture phase so we see the
// event BEFORE Vue's @click.stop modifiers have a chance to swallow
// it — relying on bubble-phase + stopPropagation produced false
// negatives in cross-Context modal teleport scenarios. Explicit
// `closest()` check excludes:
//   - clicks inside the popover (input, ↺ reset, × close button)
//   - clicks on the cog button that *opens* the popover
// Anything else closes the popover.
function onDocPointerDown(ev: MouseEvent): void {
  if (popoverFor.value === null) return;
  const target = ev.target as HTMLElement | null;
  if (!target) return;
  if (target.closest(".mx__popover")) return;
  if (target.closest('[data-test^="mx-cog-"]')) return;
  closePopover();
}
function onDocKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Escape" && popoverFor.value !== null) {
    ev.preventDefault();
    closePopover();
  }
}
onMounted(() => {
  document.addEventListener("mousedown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocPointerDown, true);
  document.removeEventListener("keydown", onDocKeydown);
});

function onCommitFactor(src: string, tgt: string, factor: number): void {
  const lib = libCell(src, tgt);
  if (!lib) return;
  const key = encodeKey([src, tgt]);
  const map = { ...cellFactorOverrides.value };
  if (factor === lib.factor) {
    delete map[key];
  } else {
    map[key] = factor;
  }
  emit("update", patchInstance(props.module, "cell_factor_overrides",
    Object.keys(map).length > 0 ? map : null,
  ));
}

function onResetFactor(src: string, tgt: string): void {
  const key = encodeKey([src, tgt]);
  const map = { ...cellFactorOverrides.value };
  delete map[key];
  emit("update", patchInstance(props.module, "cell_factor_overrides",
    Object.keys(map).length > 0 ? map : null,
  ));
}
</script>

<template>
  <section class="mx" data-test="mx-section">
    <div class="mx__label">Rule matrix</div>
    <table class="mx__table">
      <thead>
        <tr>
          <th class="mx__corner" data-test="mx-corner">
            <span class="mx__corner-src">{{ sourceName || "source" }} ↓</span>
            <span class="mx__corner-divider">/</span>
            <span class="mx__corner-tgt">{{ targetName || "target" }} →</span>
          </th>
          <th v-for="t in targetSubs" :key="t" class="mx__th">{{ t }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in sourceSubs" :key="s">
          <th class="mx__th mx__th--row">{{ s }}</th>
          <td v-for="t in targetSubs" :key="`${s}-${t}`" class="mx__td">
            <div
              :class="cellClass(s, t)"
              :data-test="`mx-cell-${s}-${t}`"
              role="button"
              tabindex="0"
              @click="onCellClick(s, t)"
              @keydown.enter.prevent="onCellClick(s, t)"
              @keydown.space.prevent="onCellClick(s, t)"
            >
              <span class="mx__mode-label">{{ effectiveMode(s, t) }}</span>
              <span
                v-if="effectiveMode(s, t) === 'boost' || effectiveMode(s, t) === 'reduce'"
                class="mx__factor"
              >×{{ effectiveFactor(s, t) }}</span>
              <button
                v-if="effectiveMode(s, t) === 'boost' || effectiveMode(s, t) === 'reduce'"
                type="button"
                class="mx__cog"
                :data-test="`mx-cog-${s}-${t}`"
                aria-label="Edit factor"
                @click="(ev) => onCogClick(s, t, ev)"
              ><i class="pi pi-cog" aria-hidden="true" /></button>
              <div
                v-if="isPopoverOpen(s, t)"
                class="mx__popover"
                @click.stop
                @wheel.stop
                @keydown.stop
              >
                <CellFactorPopover
                  :library-factor="libCell(s, t)?.factor ?? 1"
                  :override-factor="cellFactorOverrides[encodeKey([s, t])] ?? null"
                  :label="`${s} → ${t}`"
                  @commit="(f) => onCommitFactor(s, t, f)"
                  @reset="() => onResetFactor(s, t)"
                  @close="closePopover"
                />
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.mx {
  padding: 12px 16px;
  background: var(--wp-bg2);
  border-bottom: 1px solid var(--wp-border-soft, var(--wp-border));
}
.mx__label {
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--wp-text-dim, var(--wp-text3));
  margin-bottom: 8px;
}
.mx__table {
  border-collapse: collapse;
  width: 100%;
  font: 11px var(--wp-font-sans);
}
.mx__th {
  font: 600 10px var(--wp-font-mono);
  color: var(--wp-text-muted, var(--wp-text2));
  background: var(--wp-bg3);
  padding: 4px 8px;
  text-align: center;
  border: 1px solid var(--wp-border);
}
.mx__th--row { text-align: right; }
.mx__corner {
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  font: 9px var(--wp-font-mono);
  color: var(--wp-text-dim, var(--wp-text3));
  text-transform: none;
  letter-spacing: 0;
  white-space: nowrap;
  padding: 4px 8px;
  text-align: left;
}
.mx__corner-src { color: var(--wp-text-muted, var(--wp-text2)); font-weight: 600; }
.mx__corner-tgt { color: var(--wp-text-muted, var(--wp-text2)); font-weight: 600; }
.mx__corner-divider { margin: 0 4px; color: var(--wp-text-dim, var(--wp-text3)); }
.mx__td { border: 1px solid var(--wp-border); padding: 0; position: relative; }
.mx__cell {
  display: flex; align-items: center; justify-content: center;
  gap: 4px;
  padding: 4px 6px;
  cursor: pointer;
  font: 600 9px var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  user-select: none;
  min-height: 22px;
}
.mx__cell--allow { background: color-mix(in srgb, var(--wp-success, #6bc96f) 22%, transparent); color: var(--wp-success, #6bc96f); }
.mx__cell--exclude { background: color-mix(in srgb, var(--wp-danger, #e05252) 22%, transparent); color: var(--wp-danger, #e05252); }
.mx__cell--boost { background: color-mix(in srgb, var(--wp-accent) 22%, transparent); color: var(--wp-accent-text, var(--wp-text)); }
.mx__cell--reduce { background: color-mix(in srgb, var(--wp-warn, #f59e0b) 22%, transparent); color: var(--wp-warn, #f59e0b); }
.mx__cell--disabled {
  background: repeating-linear-gradient(
    45deg,
    rgba(120, 120, 120, 0.18),
    rgba(120, 120, 120, 0.18) 4px,
    rgba(120, 120, 120, 0.06) 4px,
    rgba(120, 120, 120, 0.06) 8px
  );
  color: var(--wp-text-dim, var(--wp-text3));
  text-decoration: line-through;
}
.mx__cell--overridden {
  outline: 1px dashed var(--wp-status-modified, #fb923c);
  outline-offset: -1px;
}
.mx__cell--empty { cursor: default; opacity: 0.4; }
.mx__factor { font-family: var(--wp-font-mono); font-weight: 400; text-transform: none; letter-spacing: 0; }
.mx__cog {
  background: transparent;
  border: 0;
  color: var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
  padding: 1px 2px;
  font-size: 10px;
  opacity: 0.55;
}
.mx__cog:hover { opacity: 1; color: var(--wp-accent-text, var(--wp-text)); }
.mx__popover {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 10;
  margin-top: 4px;
}
</style>
