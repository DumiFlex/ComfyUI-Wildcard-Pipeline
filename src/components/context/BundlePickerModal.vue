<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import ModalShell from "../shared/ModalShell.vue";
import { api } from "../../manager/api/client";
import type { BundleRow } from "../../manager/api/types";

const props = defineProps<{
  visible: boolean;
  /** IDs of bundles already inserted into the current Context. Used
   *  for the "already added" affordance — not yet enforced as a hard
   *  block (users may want a second instance of the same bundle). */
  alreadyAddedIds?: string[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
  /** Fired when user picks a bundle row. Caller fetches the full
   *  bundle (with children) + runs the insert flow. */
  (e: "pick", bundleId: string): void;
  /** Fired when user clicks "+ Create Bundle" — caller opens the SPA
   *  bundle editor in author-mode. */
  (e: "create"): void;
}>();

const items = ref<BundleRow[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);
const searchTerm = ref("");
const focusedIdx = ref(0);
const searchInput = ref<HTMLInputElement | null>(null);

const filtered = computed(() => {
  const q = searchTerm.value.trim().toLowerCase();
  if (!q) return items.value;
  return items.value.filter((b) => b.name.toLowerCase().includes(q));
});

async function reload() {
  loading.value = true;
  loadError.value = null;
  try {
    const res = await api.bundles.list({});
    items.value = res.items;
    focusedIdx.value = 0;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      await reload();
      await nextTick();
      searchInput.value?.focus();
    }
  },
  { immediate: true },
);

function frameColor(b: BundleRow): string {
  return b.color && b.color.length ? b.color : "var(--wp-bundle-default)";
}

function kindCompositionPills(b: BundleRow): Array<{ label: string; cls: string }> {
  /** Counts module kinds in a bundle's children to render the
   *  composition pills ("3W 1C 1Cb") shown on each list row. Maps
   *  engine type → 1-2 char abbreviation. */
  const counts: Record<string, number> = {};
  for (const child of b.children) {
    const t = typeof child.type === "string" ? child.type : "";
    counts[t] = (counts[t] ?? 0) + 1;
  }
  const order: Array<[string, string, string]> = [
    ["wildcard",    "W",  "comp-pill comp-w"],
    ["constraint",  "C",  "comp-pill comp-x"],
    ["combine",     "Cb", "comp-pill comp-c"],
    ["fixed_values","F",  "comp-pill comp-f"],
    ["derivation",  "D",  "comp-pill comp-d"],
  ];
  const out: Array<{ label: string; cls: string }> = [];
  for (const [type, abbr, cls] of order) {
    const n = counts[type];
    if (n) out.push({ label: `${n}${abbr}`, cls });
  }
  return out;
}

function pickRow(b: BundleRow) {
  emit("pick", b.id);
  emit("close");
}

function onKeydown(ev: KeyboardEvent) {
  if (!props.visible) return;
  const list = filtered.value;
  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    if (!list.length) return;
    focusedIdx.value = (focusedIdx.value + 1) % list.length;
  } else if (ev.key === "ArrowUp") {
    ev.preventDefault();
    if (!list.length) return;
    focusedIdx.value = (focusedIdx.value - 1 + list.length) % list.length;
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    const row = list[focusedIdx.value];
    if (row) pickRow(row);
  } else if (ev.key === "/" && document.activeElement !== searchInput.value) {
    ev.preventDefault();
    searchInput.value?.focus();
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

const alreadyAddedSet = computed(() => new Set(props.alreadyAddedIds ?? []));
</script>

<template>
  <ModalShell :visible="visible" @close="emit('close')">
    <div class="wp-bp" role="dialog">
      <header class="wp-bp__head">
        <div class="wp-bp__head-text">
          <div class="wp-bp__eyebrow">Add bundle from library</div>
          <div class="wp-bp__title">
            Browse Bundles
            <span class="wp-bp__title-detail">· {{ filtered.length }} {{ filtered.length === 1 ? "bundle" : "bundles" }}</span>
          </div>
        </div>
        <button
          type="button"
          class="wp-bp__close"
          aria-label="Close"
          @click="emit('close')"
        ><i class="pi pi-times" /></button>
      </header>

      <div class="wp-bp__toolbar">
        <div class="wp-bp__search">
          <i class="pi pi-search" aria-hidden="true"></i>
          <input
            ref="searchInput"
            v-model="searchTerm"
            type="text"
            placeholder="Search bundles by name…"
            aria-label="Search bundles"
            data-testid="bundle-picker-search"
          />
          <span v-if="searchTerm" class="wp-bp__search-clear" @click="searchTerm = ''">
            <i class="pi pi-times" aria-hidden="true"></i>
          </span>
        </div>
      </div>

      <div class="wp-bp__body">
        <div v-if="loading" class="wp-bp__state">
          <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
          Loading bundles…
        </div>
        <div v-else-if="loadError" class="wp-bp__state wp-bp__state--err">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          {{ loadError }}
          <button type="button" class="wp-bp__retry" @click="reload">Retry</button>
        </div>
        <div v-else-if="filtered.length === 0" class="wp-bp__state">
          <i class="pi pi-inbox" aria-hidden="true"></i>
          {{ searchTerm ? `No matches for "${searchTerm}"` : "No bundles in library yet — click + Create Bundle to author one." }}
        </div>

        <div v-else class="wp-bp__list">
          <button
            v-for="(b, idx) in filtered"
            :key="b.id"
            type="button"
            :data-bundle-id="b.id"
            :data-testid="`bundle-picker-row-${b.id}`"
            :class="[
              'wp-bp__row',
              {
                'is-focused': focusedIdx === idx,
                'is-already-added': alreadyAddedSet.has(b.id),
              },
            ]"
            :style="{ '--c': frameColor(b) }"
            :title="alreadyAddedSet.has(b.id) ? 'Already in this Context. Click to add another instance.' : ''"
            @click="pickRow(b)"
            @mouseenter="focusedIdx = idx"
          >
            <span class="wp-bp__row-icon">
              <i class="pi pi-box" aria-hidden="true"></i>
            </span>
            <span class="wp-bp__row-name">{{ b.name }}</span>
            <span class="wp-bp__row-count">{{ b.children.length }} mods</span>
            <span class="wp-bp__row-comp">
              <span
                v-for="(pill, i) in kindCompositionPills(b)"
                :key="i"
                :class="pill.cls"
              >{{ pill.label }}</span>
            </span>
          </button>
        </div>
      </div>

      <div class="wp-bp__foot">
        <div class="wp-bp__hints">
          <span class="wp-bp__kbd">↑</span>
          <span class="wp-bp__kbd">↓</span>
          <span class="wp-bp__hint-label">nav</span>
          <span class="wp-bp__hint-sep">·</span>
          <span class="wp-bp__kbd">↵</span>
          <span class="wp-bp__hint-label">insert</span>
          <span class="wp-bp__hint-sep">·</span>
          <span class="wp-bp__kbd">/</span>
          <span class="wp-bp__hint-label">search</span>
          <span class="wp-bp__hint-sep">·</span>
          <span class="wp-bp__kbd">esc</span>
          <span class="wp-bp__hint-label">cancel</span>
        </div>
        <button type="button" class="wp-bp__btn" @click="emit('close')">Cancel</button>
        <button
          type="button"
          class="wp-bp__btn wp-bp__btn--primary"
          data-testid="bundle-picker-create"
          @click="emit('create')"
        ><i class="pi pi-plus" aria-hidden="true" /> Create Bundle</button>
      </div>
    </div>
  </ModalShell>
</template>

<style scoped>
@import "../shared/theme.css";

.wp-bp {
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 8px;
  width: 720px;
  max-width: 92vw;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: var(--wp-shadow-lg, 0 20px 60px rgba(0, 0, 0, 0.5));
}

/* Header — brand gradient + dark wash overlay, matches edit modals. */
.wp-bp__head {
  background: var(--wp-brand-gradient);
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--wp-border);
  position: relative;
}
.wp-bp__head::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(35, 35, 35, 0.85);
  pointer-events: none;
}
.wp-bp__head > * { position: relative; z-index: 1; }
.wp-bp__head-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.wp-bp__eyebrow {
  font: 500 11px/1.2 var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-bp__title {
  font: 700 15px/1.1 var(--wp-font-sans);
  color: var(--wp-text);
}
.wp-bp__title-detail {
  color: var(--wp-text-dim, var(--wp-text3));
  font-weight: 500;
  font-size: 13px;
  margin-left: 4px;
}
.wp-bp__close {
  width: 28px;
  height: 28px;
  background: transparent;
  border: 1px solid var(--wp-border);
  color: var(--wp-text-dim, var(--wp-text3));
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.wp-bp__close:hover { background: var(--wp-bg2); color: var(--wp-text); }

.wp-bp__toolbar {
  padding: 10px 14px;
  border-bottom: 1px solid var(--wp-border);
  display: flex;
  gap: 8px;
}
.wp-bp__search {
  flex: 1;
  display: flex;
  align-items: center;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: 4px;
  padding: 0 8px;
  gap: 6px;
}
.wp-bp__search:focus-within { border-color: var(--wp-accent); }
.wp-bp__search input {
  flex: 1;
  background: transparent;
  border: 0;
  color: var(--wp-text);
  padding: 6px 0;
  font: 500 12px var(--wp-font-sans);
  outline: 0;
}
.wp-bp__search input::placeholder { color: var(--wp-text-dim, var(--wp-text3)); }
.wp-bp__search-clear {
  cursor: pointer;
  color: var(--wp-text-dim, var(--wp-text3));
  font-size: 11px;
}

.wp-bp__body {
  max-height: 460px;
  overflow-y: auto;
  background: var(--wp-bg);
}

.wp-bp__state {
  padding: 24px;
  text-align: center;
  color: var(--wp-text-dim, var(--wp-text3));
  font: 500 12px var(--wp-font-sans);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}
.wp-bp__state--err { color: var(--wp-red); }
.wp-bp__retry {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  color: var(--wp-text);
  padding: 5px 12px;
  border-radius: 4px;
  cursor: pointer;
  font: 500 11px var(--wp-font-sans);
}

.wp-bp__list {
  display: flex;
  flex-direction: column;
  padding: 6px;
  gap: 2px;
}
.wp-bp__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-left: 3px solid var(--c, var(--wp-bundle-default));
  border-radius: 4px;
  cursor: pointer;
  color: var(--wp-text);
  text-align: left;
  font: 500 12px var(--wp-font-sans);
}
.wp-bp__row:hover { background: var(--wp-bg2); border-color: var(--c, var(--wp-bundle-default)); }
.wp-bp__row.is-focused {
  background: var(--wp-bg2);
  border-color: var(--wp-accent);
  border-left-color: var(--c, var(--wp-bundle-default));
  box-shadow: 0 0 0 1px var(--wp-accent);
}
.wp-bp__row.is-already-added {
  opacity: 0.6;
}
.wp-bp__row-icon {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--c, var(--wp-bundle-default)) 16%, transparent);
  color: var(--c, var(--wp-bundle-default));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 11px;
}
.wp-bp__row-name {
  flex: 1;
  font: 600 13px/1 var(--wp-font-sans);
  color: var(--wp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-bp__row-count {
  font: 500 10px var(--wp-font-sans);
  color: var(--wp-text-dim, var(--wp-text3));
  flex-shrink: 0;
}
.wp-bp__row-comp {
  display: inline-flex;
  gap: 3px;
  flex-shrink: 0;
}
.comp-pill {
  font: 600 9px/1 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 5px;
  border-radius: 3px;
}
.comp-w { background: color-mix(in srgb, var(--wp-kind-wildcard) 22%, transparent); color: var(--wp-kind-wildcard); }
.comp-c { background: color-mix(in srgb, var(--wp-kind-combine) 22%, transparent); color: var(--wp-kind-combine); }
.comp-f { background: color-mix(in srgb, var(--wp-kind-fixed) 22%, transparent); color: var(--wp-kind-fixed); }
.comp-d { background: color-mix(in srgb, var(--wp-kind-derivation) 22%, transparent); color: var(--wp-kind-derivation); }
.comp-x { background: color-mix(in srgb, var(--wp-kind-constraint) 22%, transparent); color: var(--wp-kind-constraint); }

/* Footer — keyboard hints inline with Cancel + Create. Matches the
 * module picker pattern: kbd chips are neutral, not amber. */
.wp-bp__foot {
  border-top: 1px solid var(--wp-border);
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--wp-bg-deep, var(--wp-bg));
}
.wp-bp__hints {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  color: var(--wp-text-dim, var(--wp-text3));
  font: 500 11px/1 var(--wp-font-sans);
  flex: 1;
}
.wp-bp__kbd {
  font: 600 10px/1 var(--wp-font-mono, monospace);
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-bottom-width: 2px;
  border-radius: 3px;
  padding: 2px 5px;
  color: var(--wp-text);
}
.wp-bp__hint-sep { color: var(--wp-text3); margin: 0 1px; }
.wp-bp__hint-label { color: var(--wp-text-dim, var(--wp-text3)); }
.wp-bp__btn {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  color: var(--wp-text);
  padding: 7px 16px;
  border-radius: 4px;
  font: 500 12px var(--wp-font-sans);
  cursor: pointer;
}
.wp-bp__btn:hover { background: var(--wp-bg3); }
.wp-bp__btn--primary {
  background: var(--wp-accent);
  color: white;
  border-color: var(--wp-accent);
  font-weight: 600;
}
.wp-bp__btn--primary:hover {
  background: color-mix(in srgb, var(--wp-accent) 90%, white);
}
</style>
