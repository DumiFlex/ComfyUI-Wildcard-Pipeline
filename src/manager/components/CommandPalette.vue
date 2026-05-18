<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import Icon from "./ui/Icon.vue";
import { rankCommands } from "../utils/commandRank";

export interface CommandItem {
  id: string;
  label: string;
  kind: "module" | "bundle" | "category" | "route" | "action";
  icon: string;
  subtitle?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  items: CommandItem[];
  /** Bonus score added to items whose id is in this list. */
  recentIds?: string[];
}

const props = withDefaults(defineProps<Props>(), { recentIds: () => [] });

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const query = ref("");
const selectedIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);

const ranked = computed(() => {
  if (!query.value.trim()) {
    // Show top recents first, then everything else (capped for perf).
    const recentSet = new Set(props.recentIds);
    const recents = props.items.filter((i) => recentSet.has(i.id));
    const rest = props.items.filter((i) => !recentSet.has(i.id));
    return [...recents, ...rest].slice(0, 50);
  }
  return rankCommands(props.items, query.value, props.recentIds).slice(0, 50);
});

watch(() => props.open, async (open) => {
  if (open) {
    query.value = "";
    selectedIndex.value = 0;
    await nextTick();
    inputRef.value?.focus();
  }
});

watch(ranked, () => { selectedIndex.value = 0; });

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
    if (item) {
      item.run();
      emit("update:open", false);
    }
  }
}

function onClickItem(item: CommandItem) {
  item.run();
  emit("update:open", false);
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
          <ul class="wp-cp__results" role="listbox" aria-label="Commands">
            <li
              v-for="(item, idx) in ranked"
              :key="item.id"
              data-test="cp-result"
              role="option"
              :class="['wp-cp__row', { 'wp-cp__row--active': idx === selectedIndex }]"
              :aria-selected="idx === selectedIndex"
              @click="onClickItem(item)"
              @keydown.enter="onClickItem(item)"
              @mouseenter="selectedIndex = idx"
              @focusin="selectedIndex = idx"
            >
              <Icon :name="item.icon" :size="14" class="wp-cp__row-icon" />
              <span class="wp-cp__row-label">{{ item.label }}</span>
              <span v-if="item.subtitle" class="wp-cp__row-subtitle">{{ item.subtitle }}</span>
            </li>
            <li v-if="!ranked.length" class="wp-cp__empty">No matches.</li>
          </ul>
          <div class="wp-cp__hint">
            <kbd>↑↓</kbd> navigate · <kbd>↵</kbd> open · <kbd>Esc</kbd> close
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
  height: var(--wp-control-h-lg);
  padding: 0 var(--wp-space-5);
  border: none;
  border-bottom: 1px solid var(--wp-border);
  background: transparent;
  color: var(--wp-text);
  font-size: var(--wp-text-md);
  font-family: var(--wp-font);
  outline: none;
}
.wp-cp__results {
  list-style: none; margin: 0; padding: var(--wp-space-2) 0;
  overflow-y: auto; flex: 1;
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
.wp-cp__hint kbd {
  font-family: var(--wp-font-mono);
  background: var(--wp-bg-3);
  padding: 1px var(--wp-space-2);
  border-radius: var(--wp-radius-sm);
}
</style>
