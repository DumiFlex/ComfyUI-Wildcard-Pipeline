<script setup lang="ts">
/**
 * The Bookmarks dock: a small panel pinned to the canvas edge listing every
 * WP Bookmark in the workflow. A row click jumps there; the eye shows or
 * hides the bookmark on the canvas (the only way back for a hidden one);
 * the grip reorders, which is also the order Previous / Next walk.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import CloseButton from "../../kit/CloseButton.vue";
import Kbd from "../../kit/Kbd.vue";
import SortableList from "../../kit/SortableList.vue";
import WpButton from "../../kit/WpButton.vue";
import WpIconButton from "../../kit/WpIconButton.vue";
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
  type BookmarkEntry,
  type DockPrefs,
} from "../../widgets/bookmark";

const emit = defineEmits<{ (e: "close"): void }>();

const prefs = ref<DockPrefs>(readDockPrefs());
function savePrefs(part: Partial<DockPrefs>): void {
  prefs.value = { ...prefs.value, ...part };
  writeDockPrefs(prefs.value);
}

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
  place();
  const el = document.querySelector(".graph-canvas-container");
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

// ── placement: inside the canvas, under its top bar ──────────────────
const box = ref({ top: 64, left: 16, right: 16 });
let observer: ResizeObserver | null = null;
function place(): void {
  const el = document.querySelector<HTMLElement>(".graph-canvas-container");
  if (!el) return;
  const r = el.getBoundingClientRect();
  box.value = {
    top: r.top + 56,
    left: r.left + 12,
    right: Math.max(8, window.innerWidth - r.right + 12),
  };
}
const style = computed(() => ({
  top: `${box.value.top}px`,
  ...(prefs.value.side === "left" ? { left: `${box.value.left}px` } : { right: `${box.value.right}px` }),
}));

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

function onRowKey(e: KeyboardEvent, b: BookmarkEntry): void {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    jumpTo(b.node);
  }
}

function close(): void {
  savePrefs({ open: false });
  emit("close");
}
</script>

<template>
  <section
    class="wp-bmdock"
    :class="{ 'wp-bmdock--collapsed': prefs.collapsed }"
    :style="style"
    aria-label="Bookmarks"
    data-test="bm-dock"
  >
    <header class="wp-bmdock__head">
      <WpIconButton
        variant="bare"
        :icon="prefs.collapsed ? 'pi-chevron-right' : 'pi-chevron-down'"
        :label="prefs.collapsed ? 'Expand the dock' : 'Collapse the dock'"
        data-test="bm-dock-collapse"
        @click="savePrefs({ collapsed: !prefs.collapsed })"
      />
      <i class="pi pi-bookmark wp-bmdock__mark" aria-hidden="true" />
      <span class="wp-bmdock__title">Bookmarks</span>
      <span class="wp-bmdock__count">{{ shown }}<template v-if="hiddenCount"> · {{ hiddenCount }} hidden</template></span>
      <span class="wp-bmdock__spacer" />
      <WpIconButton icon="pi-undo" label="Back to where you were" :disabled="!back" data-test="bm-dock-back" @click="jumpBack" />
      <WpIconButton icon="pi-arrow-up" label="Previous bookmark" :disabled="!shown" data-test="bm-dock-prev" @click="jumpStep(-1)" />
      <WpIconButton icon="pi-arrow-down" label="Next bookmark" :disabled="!shown" data-test="bm-dock-next" @click="jumpStep(1)" />
      <WpIconButton
        :icon="prefs.side === 'left' ? 'pi-arrow-right' : 'pi-arrow-left'"
        :label="prefs.side === 'left' ? 'Move the dock to the right' : 'Move the dock to the left'"
        data-test="bm-dock-side"
        @click="savePrefs({ side: prefs.side === 'left' ? 'right' : 'left' })"
      />
      <CloseButton size="sm" label="Close the dock" data-test="bm-dock-close" @click="close" />
    </header>

    <div v-if="!prefs.collapsed" class="wp-bmdock__body">
      <SortableList
        v-if="shown"
        :model-value="entries"
        :item-key="keyOf"
        :item-label="(b: BookmarkEntry) => b.title"
        label="Bookmarks in this workflow"
        size="sm"
        @update:model-value="onReorder"
      >
        <template #item="{ item, index }">
          <div
            class="wp-bmdock__row"
            :class="{
              'is-off': (item as BookmarkEntry).disabled,
              'is-hidden': (item as BookmarkEntry).config.hidden,
              'is-current': current === (item as BookmarkEntry).node,
            }"
            :style="(item as BookmarkEntry).config.color ? { '--wp-bm-color': (item as BookmarkEntry).config.color } : undefined"
            role="button"
            tabindex="0"
            :aria-label="`Jump to ${(item as BookmarkEntry).title}`"
            :data-test="`bm-dock-row-${index}`"
            @click="jumpTo((item as BookmarkEntry).node)"
            @keydown="onRowKey($event, item as BookmarkEntry)"
          >
            <span class="wp-bmdock__num">{{ index + 1 }}</span>
            <i class="pi wp-bmdock__icon" :class="`pi-${(item as BookmarkEntry).config.icon}`" aria-hidden="true" />
            <span class="wp-bmdock__name">{{ (item as BookmarkEntry).title }}</span>
            <i v-if="(item as BookmarkEntry).nested" class="pi pi-sitemap wp-bmdock__sub" title="In a subgraph" aria-label="In a subgraph" />
            <span v-if="(item as BookmarkEntry).disabled" class="wp-bmdock__off">off</span>
            <Kbd v-else-if="(item as BookmarkEntry).config.shortcut" :keys="(item as BookmarkEntry).config.shortcut" size="sm" />
            <WpIconButton
              :icon="(item as BookmarkEntry).config.hidden ? 'pi-eye-slash' : 'pi-eye'"
              :label="(item as BookmarkEntry).config.hidden ? 'Show on canvas' : 'Hide on canvas'"
              :pressed="(item as BookmarkEntry).config.hidden"
              :data-test="`bm-dock-eye-${index}`"
              @click.stop="setHidden((item as BookmarkEntry).node, !(item as BookmarkEntry).config.hidden)"
            />
          </div>
        </template>
      </SortableList>
      <p v-else class="wp-bmdock__empty" data-test="bm-dock-empty">
        No bookmarks in this workflow yet.
      </p>
      <WpButton variant="add" size="sm" block icon="pi-plus" data-test="bm-dock-add" @click="addBookmarkHere()">
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
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: min(8px, var(--wp-radius-cap, 999px));
  box-shadow: var(--wp-shadow-md, 0 4px 14px rgb(0 0 0 / 0.35));
}
.wp-bmdock--collapsed { width: auto; }
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
.wp-bmdock__row {
  --wp-bm-color: var(--wp-accent);
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 2px 0 6px;
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  cursor: pointer;
  box-shadow: inset 2px 0 0 var(--wp-bm-color);
}
.wp-bmdock__row:hover { background: var(--wp-bg-3, var(--wp-bg-1)); }
.wp-bmdock__row:focus-visible { outline: 2px solid var(--wp-accent); outline-offset: -2px; }
.wp-bmdock__row.is-current { background: color-mix(in srgb, var(--wp-bm-color) 14%, transparent); }
.wp-bmdock__row.is-off { opacity: 0.55; }
.wp-bmdock__row.is-hidden .wp-bmdock__name { font-style: italic; color: var(--wp-text-dim); }
.wp-bmdock__num {
  min-width: 14px;
  color: var(--wp-text-dim);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.wp-bmdock__icon { color: var(--wp-bm-color); font-size: 12px; }
.wp-bmdock__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-weight: 600;
}
.wp-bmdock__sub { color: var(--wp-text-dim); font-size: 11px; }
.wp-bmdock__off { color: var(--wp-text-dim); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; }
.wp-bmdock__empty { margin: 4px 2px; color: var(--wp-text-dim); }
</style>
