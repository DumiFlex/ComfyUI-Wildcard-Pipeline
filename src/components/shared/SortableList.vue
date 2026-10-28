<script setup lang="ts" generic="T">
/**
 * Sortable list: rows you put in order by dragging their grip, or from the
 * keyboard. Works on the canvas (`size="sm"`) and in the manager (`md`).
 *
 *   <SortableList v-model="rules" :item-key="(r) => r.id" :item-label="(r) => r.name" label="Rules">
 *     <template #item="{ item }">…the row…</template>
 *   </SortableList>
 *
 * Mouse, pen and touch: drag the grip; a line shows where the row lands and
 * Escape cancels. Keyboard (on the grip): Space or Enter picks the row up,
 * the arrows move it, Space or Enter drops it, Escape puts it back; Alt+↑ /
 * Alt+↓ move it one step without picking it up. Each step is said in a
 * polite live line ("Hair moved to 2 of 5"). Only the grip starts a drag,
 * so text and controls in the row work as usual.
 */
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId } from "vue";
import { dropIndex, moveItem } from "./sortable";

const props = withDefaults(defineProps<{
  modelValue: T[];
  /** A stable key per item. */
  itemKey: (item: T) => string | number;
  /** The item's name in the grip's label and the announcements. */
  itemLabel?: (item: T, index: number) => string;
  /** The list's name for screen readers. */
  label: string;
  disabled?: boolean;
  size?: "sm" | "md";
}>(), { size: "md" });

const emit = defineEmits<{
  (e: "update:modelValue", v: T[]): void;
  (e: "move", m: { from: number; to: number }): void;
}>();

const uid = useId();
const helpId = `wp-sortable-help-${uid}`;
const listEl = ref<HTMLElement | null>(null);
const said = ref("");

/** Pointer drag: which row, where it started, where it would land. */
const drag = ref<{ from: number; to: number; startY: number; dy: number; line: number } | null>(null);
let mids: number[] = [];
let tops: number[] = [];
let bottoms: number[] = [];
let listTop = 0;

/** Keyboard pick-up: the row held and the order before it was picked up. */
const held = shallowRef<{ key: string | number; before: T[] } | null>(null);

const nameOf = (item: T, i: number): string => props.itemLabel?.(item, i) ?? `Item ${i + 1}`;
const total = computed(() => props.modelValue.length);

function announce(text: string): void {
  said.value = "";
  void nextTick(() => { said.value = text; });
}

function rows(): HTMLElement[] {
  return listEl.value ? [...listEl.value.querySelectorAll<HTMLElement>(":scope > .wp-sortable__row")] : [];
}

function focusGrip(key: string | number): void {
  void nextTick(() => {
    const i = props.modelValue.findIndex((it) => props.itemKey(it) === key);
    rows()[i]?.querySelector<HTMLElement>(".wp-sortable__grip")?.focus();
  });
}

function commit(from: number, to: number): void {
  if (from === to) return;
  emit("update:modelValue", moveItem(props.modelValue, from, to));
  emit("move", { from, to });
}

// ── Pointer ─────────────────────────────────────────────────────────────
function onPointerDown(ev: PointerEvent, i: number): void {
  if (props.disabled || ev.button !== 0 || held.value) return;
  ev.preventDefault();
  const rs = rows().map((r) => r.getBoundingClientRect());
  mids = rs.map((r) => r.top + r.height / 2);
  tops = rs.map((r) => r.top);
  bottoms = rs.map((r) => r.bottom);
  listTop = listEl.value?.getBoundingClientRect().top ?? 0;
  drag.value = { from: i, to: i, startY: ev.clientY, dy: 0, line: -1 };
  (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
  window.addEventListener("keydown", onDragKey, true);
}

function lineFor(from: number, to: number): number {
  if (to === from) return -1;
  // Insert before original row k (skipping the dragged one), or after the last.
  const k = to < from ? to : to + 1;
  return (k < tops.length ? tops[k] : bottoms[bottoms.length - 1]) - listTop;
}

function onPointerMove(ev: PointerEvent): void {
  const d = drag.value;
  if (!d) return;
  const to = dropIndex(ev.clientY, mids, d.from);
  drag.value = { ...d, dy: ev.clientY - d.startY, to, line: lineFor(d.from, to) };
}

function endDrag(ev: PointerEvent | null, keep: boolean): void {
  const d = drag.value;
  if (!d) return;
  drag.value = null;
  window.removeEventListener("keydown", onDragKey, true);
  if (ev) (ev.currentTarget as HTMLElement | null)?.releasePointerCapture?.(ev.pointerId);
  if (keep && d.to !== d.from) {
    const item = props.modelValue[d.from];
    commit(d.from, d.to);
    announce(`${nameOf(item, d.from)} moved to ${d.to + 1} of ${total.value}`);
  }
}

// A list removed mid-drag must not leave its Escape listener on the window.
onBeforeUnmount(() => window.removeEventListener("keydown", onDragKey, true));

function onDragKey(ev: KeyboardEvent): void {
  if (ev.key !== "Escape") return;
  ev.preventDefault();
  ev.stopPropagation();
  endDrag(null, false);
  announce("Move cancelled");
}

// ── Keyboard ────────────────────────────────────────────────────────────
function onGripKey(ev: KeyboardEvent, i: number): void {
  if (props.disabled) return;
  const item = props.modelValue[i];
  const key = props.itemKey(item);
  const up = ev.key === "ArrowUp" || ev.key === "ArrowLeft";
  const down = ev.key === "ArrowDown" || ev.key === "ArrowRight";

  if (!held.value) {
    if (ev.key === " " || ev.key === "Enter") {
      ev.preventDefault();
      held.value = { key, before: [...props.modelValue] };
      announce(`Picked up ${nameOf(item, i)}, ${i + 1} of ${total.value}. Arrows move it, Space drops it, Escape puts it back.`);
    } else if (ev.altKey && (up || down)) {
      ev.preventDefault();
      const to = up ? i - 1 : i + 1;
      if (to < 0 || to >= total.value) return;
      commit(i, to);
      announce(`${nameOf(item, i)} moved to ${to + 1} of ${total.value}`);
      focusGrip(key);
    }
    return;
  }

  if (up || down || ev.key === "Home" || ev.key === "End") {
    ev.preventDefault();
    const to = ev.key === "Home" ? 0 : ev.key === "End" ? total.value - 1 : up ? i - 1 : i + 1;
    if (to < 0 || to >= total.value || to === i) return;
    commit(i, to);
    announce(`${nameOf(item, i)} moved to ${to + 1} of ${total.value}`);
    focusGrip(key);
  } else if (ev.key === " " || ev.key === "Enter") {
    ev.preventDefault();
    held.value = null;
    announce(`${nameOf(item, i)} dropped at ${i + 1} of ${total.value}`);
  } else if (ev.key === "Escape") {
    ev.preventDefault();
    ev.stopPropagation();
    const before = held.value.before;
    held.value = null;
    if (before.some((it, j) => it !== props.modelValue[j])) emit("update:modelValue", before);
    const back = before.findIndex((it) => props.itemKey(it) === key);
    announce(`Move cancelled. ${nameOf(item, i)} is back at ${back + 1} of ${total.value}`);
    focusGrip(key);
  }
}

function onGripBlur(i: number): void {
  // Moving the row re-inserts its element, which can blur the grip for a
  // moment; only a real focus loss drops it.
  void nextTick(() => {
    if (!held.value) return;
    const grip = rows()[props.modelValue.findIndex((it) => props.itemKey(it) === held.value?.key)]?.querySelector(".wp-sortable__grip");
    if (grip && document.activeElement !== grip) {
      const item = props.modelValue[i];
      held.value = null;
      if (item) announce(`${nameOf(item, i)} dropped`);
    }
  });
}
</script>

<template>
  <div class="wp-sortable" :data-size="size" :data-dragging="drag ? 'true' : undefined">
    <ul ref="listEl" class="wp-sortable__list" :aria-label="label">
      <li
        v-for="(item, i) in modelValue"
        :key="itemKey(item)"
        class="wp-sortable__row"
        :data-dragged="drag?.from === i || undefined"
        :data-held="held?.key === itemKey(item) || undefined"
        :style="drag?.from === i ? { transform: `translateY(${drag.dy}px)` } : undefined"
      >
        <button
          type="button"
          class="wp-sortable__grip"
          :aria-label="`Move ${nameOf(item, i)}`"
          :aria-describedby="helpId"
          :aria-pressed="held?.key === itemKey(item)"
          :disabled="disabled"
          @pointerdown="onPointerDown($event, i)"
          @pointermove="onPointerMove"
          @pointerup="endDrag($event, true)"
          @pointercancel="endDrag($event, false)"
          @keydown="onGripKey($event, i)"
          @blur="onGripBlur(i)"
        ><i class="pi pi-bars" aria-hidden="true" /></button>
        <div class="wp-sortable__body"><slot name="item" :item="item" :index="i" /></div>
      </li>
      <li v-if="drag && drag.line >= 0" class="wp-sortable__line" :style="{ top: `${drag.line}px` }" aria-hidden="true" />
    </ul>
    <span :id="helpId" class="wp-sortable__sr">Space or Enter picks it up, the arrows move it, Space drops it, Escape puts it back. Alt and an arrow moves it one step.</span>
    <span class="wp-sortable__sr" aria-live="polite">{{ said }}</span>
  </div>
</template>

<style scoped>
.wp-sortable { position: relative; min-width: 0; }
.wp-sortable__list { position: relative; display: flex; flex-direction: column; gap: var(--wp-space-2); margin: 0; padding: 0; list-style: none; }
.wp-sortable[data-size="sm"] .wp-sortable__list { gap: 2px; }
.wp-sortable__row {
  display: flex; align-items: center; gap: var(--wp-space-2); min-width: 0;
  border-radius: var(--wp-radius); background: var(--wp-bg-1);
}
.wp-sortable__row[data-dragged] {
  position: relative; z-index: 2; opacity: 0.92; box-shadow: var(--wp-shadow-md);
  outline: 1px solid var(--wp-border-strong); pointer-events: none;
}
.wp-sortable__row[data-held] { outline: 1.5px dashed var(--wp-accent); outline-offset: 1px; }
.wp-sortable__grip {
  display: inline-grid; place-items: center; flex: none; align-self: stretch;
  width: 24px; min-height: 24px; margin: 0; padding: 0; border: 0; border-radius: var(--wp-radius-sm);
  background: transparent; color: var(--wp-text-dim); cursor: grab; touch-action: none;
}
.wp-sortable[data-size="sm"] .wp-sortable__grip { width: 20px; min-height: 20px; }
.wp-sortable__grip .pi { font-size: 11px; }
.wp-sortable[data-size="sm"] .wp-sortable__grip .pi { font-size: 10px; }
.wp-sortable__grip:hover:not(:disabled) { color: var(--wp-text); background: var(--wp-row-hover); }
.wp-sortable__grip:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus); }
.wp-sortable__grip[aria-pressed="true"] { color: var(--wp-accent-text); }
.wp-sortable__grip:disabled { cursor: not-allowed; opacity: 0.45; }
.wp-sortable[data-dragging] .wp-sortable__grip { cursor: grabbing; }
.wp-sortable__body { flex: 1; min-width: 0; }
.wp-sortable__line {
  position: absolute; left: 0; right: 0; height: 2px; margin-top: -1px; border-radius: min(1px, var(--wp-radius-cap, 999px));
  background: var(--wp-accent); box-shadow: 0 0 0 2px var(--wp-accent-glow); pointer-events: none;
}
.wp-sortable__sr {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
</style>
