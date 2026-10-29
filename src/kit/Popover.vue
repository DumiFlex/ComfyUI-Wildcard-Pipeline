<script setup lang="ts">
/**
 * A panel anchored to a trigger: opens below it (or wherever `placement`
 * says), flips and stays on screen, follows the trigger on scroll and
 * resize, and closes on Escape or a click outside, giving focus back to
 * the trigger. Works on the canvas and in the manager. Anything that
 * floats next to a control builds on this instead of its own Teleport.
 *
 *   <Popover v-model:open="open" label="Category colour">
 *     <template #trigger="{ props }"><Button v-bind="props">Colour</Button></template>
 *     …panel content…
 *   </Popover>
 *
 * One panel shared by many triggers (the cells of a rule grid) passes the
 * element it belongs to as `anchor` instead of a trigger slot; clicks on that
 * element don't count as outside, so it can toggle the panel itself.
 *
 *   <Popover :open="!!cell" :anchor="cell?.el" label="Cell rule" @update:open="cell = null">…</Popover>
 */
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { placeFloating, viewportSize, type Placement, type Side } from "./floating";

const props = withDefaults(defineProps<{
  open: boolean;
  placement?: Placement | undefined;
  /** The panel's name for screen readers. */
  label?: string | undefined;
  /** Make the panel at least as wide as the trigger (lists under a field). */
  matchWidth?: boolean | undefined;
  /** Move focus into the panel when it opens. Off for panels you type past. */
  autofocus?: boolean | undefined;
  /** "dialog" for panels with controls, "menu"/"listbox" when the content is one. */
  role?: "dialog" | "menu" | "listbox" | "group" | undefined;
  /** Place the panel against this element instead of the trigger slot. */
  anchor?: HTMLElement | null | undefined;
}>(), { placement: "bottom-start", autofocus: true, role: "dialog", anchor: null });

const emit = defineEmits<{ (e: "update:open", v: boolean): void }>();

const id = `wp-popover-${useId()}`;
const anchorEl = ref<HTMLElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
const pos = ref<{ x: number; y: number; side: Side; minWidth?: number | undefined }>({ x: -9999, y: -9999, side: "bottom" });

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
  + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trigger(): HTMLElement | null {
  if (props.anchor) return props.anchor;
  const el = anchorEl.value;
  return (el?.firstElementChild as HTMLElement | null) ?? el;
}

function setOpen(v: boolean): void {
  if (v !== props.open) emit("update:open", v);
}

const triggerProps = computed(() => ({
  "aria-haspopup": (props.role === "group" ? "true" : props.role) as "true" | "dialog" | "menu" | "listbox",
  "aria-expanded": props.open,
  "aria-controls": props.open ? id : undefined,
  onClick: () => setOpen(!props.open),
}));

function place(): void {
  const t = trigger();
  const p = panelEl.value;
  if (!t || !p) return;
  const r = t.getBoundingClientRect();
  const at = placeFloating(r, { width: Math.max(p.offsetWidth, props.matchWidth ? r.width : 0), height: p.offsetHeight }, viewportSize(), {
    placement: props.placement,
  });
  pos.value = { ...at, minWidth: props.matchWidth ? r.width : undefined };
}

function onPointerDown(ev: PointerEvent): void {
  const path = ev.composedPath();
  if (panelEl.value && path.includes(panelEl.value)) return;
  if (anchorEl.value && path.includes(anchorEl.value)) return;
  if (props.anchor && path.includes(props.anchor)) return;
  setOpen(false);
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key !== "Escape") return;
  ev.preventDefault();
  ev.stopPropagation();
  setOpen(false);
  trigger()?.focus();
}

function listen(on: boolean): void {
  const m = on ? "addEventListener" : "removeEventListener";
  window[m]("pointerdown", onPointerDown as EventListener, true);
  window[m]("keydown", onKeydown as EventListener, true);
  window[m]("resize", place);
  window[m]("scroll", place, true);
}

watch(() => props.open, async (v) => {
  if (typeof window === "undefined") return;
  listen(v);
  if (!v) return;
  await nextTick();
  place();
  if (props.autofocus && panelEl.value && !panelEl.value.contains(document.activeElement)) {
    (panelEl.value.querySelector<HTMLElement>(FOCUSABLE) ?? panelEl.value).focus();
  }
}, { immediate: true });

// A shared panel moving to another trigger re-places without closing.
watch(() => props.anchor, () => { if (props.open) void nextTick(place); });

onBeforeUnmount(() => { if (typeof window !== "undefined") listen(false); });

defineExpose({ place });
</script>

<template>
  <span v-if="$slots.trigger" ref="anchorEl" class="wp-popover-anchor">
    <slot name="trigger" :props="triggerProps" :open="open" />
  </span>
  <Teleport to="body">
    <div
      v-if="open"
      :id="id"
      ref="panelEl"
      class="wp-popover"
      :data-side="pos.side"
      :role="role"
      :aria-label="label"
      tabindex="-1"
      :style="{ left: `${pos.x}px`, top: `${pos.y}px`, minWidth: pos.minWidth ? `${pos.minWidth}px` : undefined }"
    >
      <slot :close="() => setOpen(false)" />
    </div>
  </Teleport>
</template>

<style>
@layer wp-extension {
  .wp-popover-anchor { display: inline-flex; }
  .wp-popover {
    position: fixed;
    z-index: 10000;
    max-width: min(420px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    overflow: auto;
    padding: var(--wp-space-3);
    background: var(--wp-bg-2);
    color: var(--wp-text);
    border: 1px solid var(--wp-border-strong);
    border-radius: var(--wp-radius);
    box-shadow: var(--wp-shadow-md);
    font-family: var(--wp-font-sans);
    font-size: var(--wp-text-sm);
    outline: none;
    animation: wp-popover-in 120ms ease-out;
  }
  @keyframes wp-popover-in {
    from { opacity: 0; transform: translateY(-2px); }
  }
  .wp-popover[data-side="top"] { animation-name: wp-popover-in-up; }
  @keyframes wp-popover-in-up {
    from { opacity: 0; transform: translateY(2px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .wp-popover { animation: none; }
  }
}
</style>
