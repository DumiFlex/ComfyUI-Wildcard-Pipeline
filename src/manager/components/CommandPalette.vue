<script setup lang="ts">
import Kbd from "@/components/shared/Kbd.vue";
import { computed, nextTick, ref, watch } from "vue";
import Icon from "./ui/Icon.vue";
import type { CommandItem } from "./CommandPalette.types";
import { rankCommands } from "../utils/commandRank";

// `CommandItem` lives in `./CommandPalette.types.ts` so plain-TS
// consumers (e.g. utils/commandRank.ts) can import the type without
// going through the Vue SFC module shim, and to break the circular
// dependency that would otherwise exist between component + ranker.
// Re-export for consumers that prefer to import from the component
// path:
export type { CommandItem };

const MAX_ROWS = 50;
const MAX_RECENT = 5;
const RAN_KEY = "wp-palette-recent";

/** Group headings on an empty search, in this order. */
const GROUPS = ["Go to", "Create", "Actions", "Library", "Categories"] as const;

function groupOf(item: CommandItem): (typeof GROUPS)[number] {
  if (item.kind === "route") return "Go to";
  if (item.kind === "action") return item.id.startsWith("action:new-") ? "Create" : "Actions";
  if (item.kind === "category") return "Categories";
  return "Library";
}

function readRan(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RAN_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function writeRan(ids: string[]): void {
  try { localStorage.setItem(RAN_KEY, JSON.stringify(ids)); } catch { /* storage off */ }
}

interface Props {
  open: boolean;
  items: CommandItem[];
  /** Ids opened lately elsewhere (newest first): shown under Recent and
   *  given a bonus score when searching. */
  recentIds?: string[];
}

const props = withDefaults(defineProps<Props>(), { recentIds: () => [] });

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const query = ref("");
const selectedIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);

/** What was run from the palette lately, newest first. */
const ran = ref<string[]>(readRan());

/** Recent first (what the palette ran, then what was opened elsewhere). */
const recentOrder = computed(() => [...new Set([...ran.value, ...props.recentIds])]);

interface Section { title: string; items: CommandItem[] }

/** Empty search: short groups, Recent on top. A search: one ranked list. */
const sections = computed<Section[]>(() => {
  if (query.value.trim()) {
    const hits = rankCommands(props.items, query.value, recentOrder.value).slice(0, MAX_ROWS);
    return hits.length ? [{ title: "", items: hits }] : [];
  }
  const byId = new Map(props.items.map((i) => [i.id, i]));
  const recent = recentOrder.value
    .map((id) => byId.get(id))
    .filter((i): i is CommandItem => !!i)
    .slice(0, MAX_RECENT);
  const shown = new Set(recent.map((i) => i.id));
  const groups = new Map<string, CommandItem[]>(GROUPS.map((g) => [g, []]));
  for (const item of props.items) {
    if (shown.has(item.id)) continue;
    groups.get(groupOf(item))?.push(item);
  }
  let room = MAX_ROWS - recent.length;
  const out: Section[] = recent.length ? [{ title: "Recent", items: recent }] : [];
  for (const [title, items] of groups) {
    const cut = items.slice(0, Math.max(0, room));
    room -= cut.length;
    if (cut.length) out.push({ title, items: cut });
  }
  return out;
});

/** Every row in display order, for the arrow keys. */
const ranked = computed(() => sections.value.flatMap((sec) => sec.items));
/** Where each section starts in `ranked`. */
const starts = computed(() => {
  let n = 0;
  return sections.value.map((sec) => { const at = n; n += sec.items.length; return at; });
});

watch(() => props.open, async (open) => {
  if (open) {
    query.value = "";
    selectedIndex.value = 0;
    ran.value = readRan();
    await nextTick();
    inputRef.value?.focus();
  }
});

watch(ranked, () => { selectedIndex.value = 0; });

// Keep the row the arrow keys land on in view.
watch(selectedIndex, async (idx) => {
  await nextTick();
  const row = listRef.value?.querySelectorAll<HTMLElement>('[data-test="cp-result"]')[idx];
  row?.scrollIntoView?.({ block: "nearest" });
});

function run(item: CommandItem) {
  ran.value = [item.id, ...ran.value.filter((id) => id !== item.id)].slice(0, MAX_RECENT);
  writeRan(ran.value);
  item.run();
  emit("update:open", false);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    emit("update:open", false);
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    selectedIndex.value = Math.min(selectedIndex.value + 1, ranked.value.length - 1);
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0);
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    const item = ranked.value[selectedIndex.value];
    if (item) run(item);
  }
}

function onClickItem(item: CommandItem) {
  run(item);
}

function onBackdropClick() {
  emit("update:open", false);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="wp-modal" appear>
      <div
        v-if="open"
        class="wp-cp-overlay"
        role="presentation"
        @click="onBackdropClick"
        @keydown.esc="onBackdropClick"
      >
        <div class="wp-cp" role="dialog" aria-modal="true" @click.stop>
          <input
            ref="inputRef"
            v-model="query"
            data-test="cp-input"
            class="wp-cp__input"
            type="text"
            aria-label="Command search"
            placeholder="Search modules, routes, or run a command…"
            @keydown="onKeydown"
          />
          <div ref="listRef" class="wp-cp__results" role="listbox" aria-label="Commands">
            <div
              v-for="(sec, si) in sections"
              :key="sec.title || 'results'"
              role="group"
              :aria-labelledby="sec.title ? `wp-cp-group-${si}` : undefined"
              :aria-label="sec.title ? undefined : 'Results'"
            >
              <div v-if="sec.title" :id="`wp-cp-group-${si}`" class="wp-cp__group" data-test="cp-group">{{ sec.title }}</div>
              <div
                v-for="(item, i) in sec.items"
                :key="item.id"
                data-test="cp-result"
                role="option"
                tabindex="-1"
                :class="['wp-cp__row', { 'wp-cp__row--active': starts[si] + i === selectedIndex }]"
                :aria-selected="starts[si] + i === selectedIndex"
                @click="onClickItem(item)"
                @keydown.enter="onClickItem(item)"
                @mouseenter="selectedIndex = starts[si] + i"
                @focusin="selectedIndex = starts[si] + i"
              >
                <Icon :name="item.icon" :size="14" class="wp-cp__row-icon" />
                <span class="wp-cp__row-label">{{ item.label }}</span>
                <span v-if="item.subtitle" class="wp-cp__row-subtitle">{{ item.subtitle }}</span>
              </div>
            </div>
            <div v-if="!ranked.length" class="wp-cp__empty">No matches.</div>
          </div>
          <div class="wp-cp__hint">
            <Kbd keys="↑" size="sm" /><Kbd keys="↓" size="sm" /> navigate · <Kbd keys="Enter" size="sm" /> open · <Kbd keys="Esc" size="sm" /> close
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
@import "../../components/shared/_modal-motion.css";

.wp-cp-overlay {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 10vh;
  background: var(--wp-overlay-bg, rgba(0, 0, 0, 0.62));
}
.wp-cp {
  width: 640px; max-width: 92vw; max-height: 70vh;
  display: flex; flex-direction: column;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border-strong);
  border-radius: var(--wp-radius-lg);
  box-shadow: var(--wp-elev-3);
  overflow: hidden;
}
.wp-cp__input {
  width: 100%;
  /* Taller search bar — the palette is the app's "I forgot where X is"
   * tool, so giving the input some breathing room makes it feel more
   * like a hero affordance and less like a side input. */
  height: calc(var(--wp-control-h-lg) + 12px);
  padding: 0 var(--wp-space-6);
  border: none;
  /* Accent-tinted underline so the input visually anchors the palette
   * (matches the focus ring color, hints the palette is interactive). */
  border-bottom: 2px solid color-mix(in oklab, var(--wp-accent-500) 60%, var(--wp-border));
  background: color-mix(in oklab, var(--wp-accent-500) 5%, transparent);
  color: var(--wp-text);
  font-size: var(--wp-text-lg);
  font-family: var(--wp-font);
  outline: none;
  transition: background 120ms ease, border-color 120ms ease;
}
.wp-cp__input::placeholder {
  color: color-mix(in oklab, var(--wp-text-muted) 75%, var(--wp-accent-500));
}
.wp-cp__input:focus {
  background: color-mix(in oklab, var(--wp-accent-500) 9%, transparent);
  border-bottom-color: var(--wp-accent-500);
}
.wp-cp__results {
  margin: 0; padding: var(--wp-space-2) 0;
  overflow-y: auto; flex: 1;
}
/* Short group heading on an empty search (Recent, Go to, Create, …). */
.wp-cp__group {
  padding: var(--wp-space-4) var(--wp-space-5) var(--wp-space-2);
  font-size: var(--wp-text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--wp-text-dim);
}
.wp-cp__row {
  display: flex; align-items: center; gap: var(--wp-space-4);
  padding: var(--wp-space-3) var(--wp-space-5);
  cursor: pointer;
}
.wp-cp__row--active {
  background: var(--wp-bg-3);
}
.wp-cp__row-icon { flex-shrink: 0; }
.wp-cp__row-label {
  font-size: var(--wp-text-base);
  color: var(--wp-text);
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wp-cp__row-subtitle {
  font-size: var(--wp-text-xs);
  color: var(--wp-text-muted);
  flex-shrink: 0;
}
.wp-cp__empty {
  padding: var(--wp-space-6);
  text-align: center;
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
}
.wp-cp__hint {
  padding: var(--wp-space-3) var(--wp-space-5);
  border-top: 1px solid var(--wp-border);
  font-size: var(--wp-text-xs);
  color: var(--wp-text-muted);
}
</style>
