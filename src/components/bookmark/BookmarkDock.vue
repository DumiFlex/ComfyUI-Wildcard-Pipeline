<script setup lang="ts">
/**
 * The Bookmarks dock: a small panel pinned to the canvas edge listing every
 * WP Bookmark in the workflow. A row click jumps there; the eye shows or
 * hides the bookmark on the canvas (the only way back for a hidden one);
 * the grip reorders, which is also the order Previous / Next walk.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import CloseButton from "../../kit/CloseButton.vue";
import SortableList from "../../kit/SortableList.vue";
import WpButton from "../../kit/WpButton.vue";
import WpIconButton from "../../kit/WpIconButton.vue";
import DockRow from "./DockRow.vue";
import {
  addBookmarkHere,
  canGoBack,
  jumpBack,
  jumpStep,
  jumpTo,
  lastJumpedNode,
  listBookmarks,
  onBookmarksChanged,
  readDockPrefs,
  setHidden,
  setOrder,
  writeDockPrefs,
  canvasElement,
  freeInsets,
  type BookmarkEntry,
  type DockPrefs,
} from "../../widgets/bookmark";

const emit = defineEmits<{ (e: "close"): void }>();

const prefs = ref<DockPrefs>(readDockPrefs());
function savePrefs(part: Partial<DockPrefs>): void {
  prefs.value = { ...prefs.value, ...part };
  writeDockPrefs(prefs.value);
}

/** View mode lists and jumps; edit mode adds the grips, the eyes, the side
 *  switch and Bookmark this view. */
const editing = ref(false);

const entries = shallowRef<BookmarkEntry[]>([]);
const current = shallowRef<unknown>(null);
const back = ref(false);

/** What a row shows; re-read only when it changed, so a drag isn't reset
 *  by the poll. */
function signature(list: BookmarkEntry[]): string {
  return list.map((b) => [b.node.id, b.title, b.disabled, b.nested, JSON.stringify(b.config)].join("|")).join("\n");
}
let lastSig = "";
function refresh(): void {
  const list = listBookmarks();
  const sig = signature(list);
  if (sig !== lastSig) {
    lastSig = sig;
    entries.value = list;
  }
  current.value = lastJumpedNode();
  back.value = canGoBack();
}

// Nodes come and go (add, delete, workflow switch) without telling us, so
// also poll, like the widgets' `reactiveFromGraph`.
let timer = 0;
let stop: (() => void) | null = null;
onMounted(() => {
  refresh();
  stop = onBookmarksChanged(refresh);
  timer = window.setInterval(refresh, 500);
  window.addEventListener("resize", place);
  requestAnimationFrame(place);
  const el = canvasElement() ?? document.querySelector(".graph-canvas-container");
  if (el && typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(place);
    observer.observe(el);
  }
});
onBeforeUnmount(() => {
  stop?.();
  window.clearInterval(timer);
  window.removeEventListener("resize", place);
  observer?.disconnect();
});

// ── placement: inside the free part of the canvas ─────────────────────
// By default the dock sits just inside ComfyUI's own bars (sidebar,
// breadcrumb, toolbar) on its side; in edit mode it can be dragged anywhere
// and stays where it was dropped.
const root = ref<HTMLElement | null>(null);
const box = ref({ x: 16, y: 64 });
let observer: ResizeObserver | null = null;
const GAP = 12;

function clamp(x: number, y: number): { x: number; y: number } {
  const w = root.value?.offsetWidth ?? 300;
  const h = root.value?.offsetHeight ?? 40;
  return {
    x: Math.min(Math.max(4, x), Math.max(4, window.innerWidth - w - 4)),
    y: Math.min(Math.max(4, y), Math.max(4, window.innerHeight - Math.min(h, 80) - 4)),
  };
}

function place(): void {
  if (dragging) return;
  const p = prefs.value.pos;
  if (p) {
    box.value = clamp(p.x, p.y);
    return;
  }
  const el = canvasElement() ?? document.querySelector<HTMLElement>(".graph-canvas-container");
  if (!el) return;
  const r = el.getBoundingClientRect();
  const [il, it, ir] = freeInsets(el);
  const w = root.value?.offsetWidth ?? 300;
  const x = prefs.value.side === "left" ? r.left + il + GAP : r.right - ir - GAP - w;
  box.value = clamp(x, r.top + it + GAP);
}
const style = computed(() => ({ left: `${box.value.x}px`, top: `${box.value.y}px` }));

// Drag by the header in edit mode (not from its buttons).
let dragging = false;
let grab = { dx: 0, dy: 0 };
function onHeadDown(e: PointerEvent): void {
  if (!editing.value || e.button !== 0) return;
  if ((e.target as HTMLElement).closest("button, input, a")) return;
  dragging = true;
  grab = { dx: e.clientX - box.value.x, dy: e.clientY - box.value.y };
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  e.preventDefault();
}
function onHeadMove(e: PointerEvent): void {
  if (!dragging) return;
  box.value = clamp(e.clientX - grab.dx, e.clientY - grab.dy);
}
function onHeadUp(): void {
  if (!dragging) return;
  dragging = false;
  savePrefs({ pos: { ...box.value } });
}
function toSide(side: "left" | "right"): void {
  savePrefs({ side, pos: null });
  place();
}

const shown = computed(() => entries.value.length);
const hiddenCount = computed(() => entries.value.filter((b) => b.config.hidden).length);

/** Node ids repeat across subgraphs, so a nested one is keyed by its graph too. */
function keyOf(b: BookmarkEntry): string {
  const graphId = (b.graph as { id?: unknown }).id;
  return b.nested ? `${String(b.node.id)}@${String(graphId ?? "")}` : String(b.node.id);
}

function onReorder(next: BookmarkEntry[]): void {
  entries.value = next;
  setOrder(next.map((b) => b.node));
}

function close(): void {
  savePrefs({ open: false });
  emit("close");
}
</script>

<template>
  <section
    ref="root"
    class="wp-bmdock"
    :class="{ 'wp-bmdock--collapsed': prefs.collapsed, 'wp-bmdock--editing': editing }"
    :style="style"
    aria-label="Bookmarks"
    data-test="bm-dock"
  >
    <header
      class="wp-bmdock__head"
      :title="editing ? 'Drag to move the dock' : undefined"
      data-test="bm-dock-head"
      @pointerdown="onHeadDown"
      @pointermove="onHeadMove"
      @pointerup="onHeadUp"
      @pointercancel="onHeadUp"
    >
      <WpIconButton
        variant="bare"
        :icon="prefs.collapsed ? 'pi-chevron-right' : 'pi-chevron-down'"
        :label="prefs.collapsed ? 'Expand the dock' : 'Collapse the dock'"
        data-test="bm-dock-collapse"
        @click="savePrefs({ collapsed: !prefs.collapsed })"
      />
      <i :class="['pi', editing ? 'pi-arrows-alt' : 'pi-bookmark', 'wp-bmdock__mark']" aria-hidden="true" />
      <span class="wp-bmdock__title">Bookmarks</span>
      <span class="wp-bmdock__count">{{ shown }}<template v-if="hiddenCount"> · {{ hiddenCount }} hidden</template></span>
      <span class="wp-bmdock__spacer" />
      <template v-if="!editing">
        <WpIconButton icon="pi-undo" label="Back to where you were" :disabled="!back" data-test="bm-dock-back" @click="jumpBack" />
        <WpIconButton icon="pi-arrow-up" label="Previous bookmark" :disabled="!shown" data-test="bm-dock-prev" @click="jumpStep(-1)" />
        <WpIconButton icon="pi-arrow-down" label="Next bookmark" :disabled="!shown" data-test="bm-dock-next" @click="jumpStep(1)" />
        <WpIconButton icon="pi-pencil" label="Edit the bookmarks" data-test="bm-dock-edit" @click="editing = true; savePrefs({ collapsed: false })" />
      </template>
      <template v-else>
        <WpIconButton
          :icon="prefs.side === 'left' ? 'pi-arrow-right' : 'pi-arrow-left'"
          :label="prefs.side === 'left' ? 'Put the dock back at the right' : 'Put the dock back at the left'"
          data-test="bm-dock-side"
          @click="toSide(prefs.side === 'left' ? 'right' : 'left')"
        />
        <WpButton variant="primary" size="sm" data-test="bm-dock-done" @click="editing = false">Done</WpButton>
      </template>
      <CloseButton size="sm" label="Close the dock" data-test="bm-dock-close" @click="close" />
    </header>

    <div v-if="!prefs.collapsed" class="wp-bmdock__body">
      <SortableList
        v-if="editing && shown"
        :model-value="entries"
        :item-key="keyOf"
        :item-label="(b: BookmarkEntry) => b.title"
        label="Bookmarks in this workflow"
        size="sm"
        @update:model-value="onReorder"
      >
        <template #item="{ item, index }">
          <DockRow
            :entry="item as BookmarkEntry"
            :index="index"
            :current="current === (item as BookmarkEntry).node"
            editing
            @jump="jumpTo((item as BookmarkEntry).node)"
            @toggle-hidden="setHidden((item as BookmarkEntry).node, !(item as BookmarkEntry).config.hidden)"
          />
        </template>
      </SortableList>
      <ul v-else-if="shown" class="wp-bmdock__list" aria-label="Bookmarks in this workflow">
        <li v-for="(b, i) in entries" :key="keyOf(b)">
          <DockRow :entry="b" :index="i" :current="current === b.node" :editing="false" @jump="jumpTo(b.node)" />
        </li>
      </ul>
      <p v-else class="wp-bmdock__empty" data-test="bm-dock-empty">
        No bookmarks in this workflow yet.
      </p>
      <WpButton
        v-if="editing || !shown"
        variant="add"
        size="sm"
        block
        icon="pi-plus"
        data-test="bm-dock-add"
        @click="addBookmarkHere()"
      >
        Bookmark this view
      </WpButton>
    </div>
  </section>
</template>

<style scoped>
.wp-bmdock {
  position: fixed;
  z-index: 1000;
  width: 300px;
  max-height: calc(100vh - 160px);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  color: var(--wp-text);
  font: 12px var(--wp-font-sans, sans-serif);
  /* See-through, so a bookmark or note under it still shows; solid while
     the pointer is on it. */
  background: color-mix(in srgb, var(--wp-bg-2) 78%, transparent);
  backdrop-filter: blur(2px);
  transition: background-color 120ms;
  border: 1px solid var(--wp-border);
  border-radius: min(8px, var(--wp-radius-cap, 999px));
  box-shadow: var(--wp-shadow-md, 0 4px 14px rgb(0 0 0 / 0.35));
}
.wp-bmdock:hover,
.wp-bmdock:focus-within { background: var(--wp-bg-2); }
.wp-bmdock--collapsed { width: auto; }
.wp-bmdock--editing .wp-bmdock__head { cursor: move; touch-action: none; }
.wp-bmdock__head {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
}
.wp-bmdock--collapsed .wp-bmdock__head { gap: 4px; }
.wp-bmdock__mark { color: var(--wp-accent); font-size: 12px; margin: 0 2px; }
.wp-bmdock__title { font-weight: 600; }
.wp-bmdock__count { margin-left: 6px; color: var(--wp-text-dim); font-size: 11px; white-space: nowrap; }
.wp-bmdock__spacer { flex: 1; }
.wp-bmdock__body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 6px 6px;
  overflow: auto;
  border-top: 1px solid var(--wp-border);
  padding-top: 6px;
}
.wp-bmdock__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.wp-bmdock__empty { margin: 4px 2px; color: var(--wp-text-dim); }
</style>
