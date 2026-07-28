<script setup lang="ts">
/**
 * IconPicker — pick one PrimeIcons glyph, or none.
 *
 * The `icon` column has existed on categories end-to-end (engine column,
 * `wp_api/categories.py` `_UPDATABLE_FIELDS`, `CategoryRow.icon`) with no UI
 * to set it, so every category rendered with the same generic bookmark.
 *
 * PrimeIcons ships ~300 glyphs; this offers a CURATED subset. The full set
 * would need its own search UI and most of it (chevrons, spinners, media
 * transport) is chrome that means nothing as a library label. The list below
 * is grouped by the kinds of things people actually categorise prompt modules
 * by — subjects, clothing, scenery, light, mood, technical.
 *
 * The glyph name is stored WITHOUT the `pi pi-` prefix (e.g. `"user"`), which
 * is what the engine column already holds and what `Icon.vue` expects.
 */
import { computed, nextTick, onBeforeUnmount, ref } from "vue";

const props = withDefaults(
  defineProps<{
    /** Current glyph name, unprefixed (`"user"`). Empty / null = none. */
    modelValue: string | null;
    ariaLabel?: string;
    dataTest?: string;
  }>(),
  { ariaLabel: "Pick an icon", dataTest: undefined },
);

const emit = defineEmits<{ "update:modelValue": [v: string | null] }>();

/** Curated glyphs, grouped for scanning. Names are PrimeIcons ids minus the
 *  `pi-` prefix. Keep additions meaningful as a category label. */
const ICON_GROUPS: { label: string; icons: string[] }[] = [
  {
    label: "Subject",
    icons: ["user", "users", "heart", "star", "eye", "face-smile", "crown", "id-card"],
  },
  {
    label: "Style & look",
    icons: ["palette", "pencil", "brush", "camera", "image", "sparkles", "sun", "moon"],
  },
  {
    label: "Scene",
    icons: ["home", "building", "map", "map-marker", "globe", "compass", "car", "cloud"],
  },
  {
    label: "Structure",
    icons: ["box", "folder", "book", "tag", "tags", "list", "sitemap", "objects-column"],
  },
  {
    label: "Signals",
    icons: ["bolt", "flag", "bell", "shield", "lock", "wrench", "filter", "info-circle"],
  },
];

const open = ref(false);
const triggerEl = ref<HTMLButtonElement | null>(null);
const panelEl = ref<HTMLDivElement | null>(null);
const pos = ref<{ top: number; left: number }>({ top: 0, left: 0 });

const PANEL_W = 236;
const PANEL_MAX_H = 300;

const current = computed<string | null>(() => props.modelValue || null);

function position(): void {
  const btn = triggerEl.value;
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const margin = 8;
  const flip = window.innerHeight - r.bottom - margin < PANEL_MAX_H && r.top > PANEL_MAX_H;
  pos.value = {
    top: flip ? Math.max(margin, r.top - PANEL_MAX_H - 4) : r.bottom + 4,
    left: Math.max(margin, Math.min(r.left, window.innerWidth - PANEL_W - margin)),
  };
}

/** Close on any click outside the panel and its trigger. Capture phase so it
 *  runs before a click inside a host row can re-open it. */
function onDocMouseDown(ev: MouseEvent): void {
  const t = ev.target as Node | null;
  if (!t) return;
  if (panelEl.value?.contains(t) || triggerEl.value?.contains(t)) return;
  close();
}

function openPanel(): void {
  open.value = true;
  void nextTick(() => {
    position();
    document.addEventListener("mousedown", onDocMouseDown, true);
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
  });
}

function close(): void {
  if (!open.value) return;
  open.value = false;
  document.removeEventListener("mousedown", onDocMouseDown, true);
  window.removeEventListener("scroll", position, true);
  window.removeEventListener("resize", position);
}

function toggle(): void {
  if (open.value) close();
  else openPanel();
}

function pick(name: string | null): void {
  emit("update:modelValue", name);
  close();
}

onBeforeUnmount(close);
</script>

<template>
  <button
    ref="triggerEl"
    type="button"
    class="wp-iconpick__trigger"
    :aria-label="ariaLabel"
    :aria-expanded="open"
    :data-test="dataTest"
    @click="toggle"
  >
    <i v-if="current" :class="`pi pi-${current}`" aria-hidden="true" />
    <span v-else class="wp-iconpick__none" aria-hidden="true">—</span>
    <i class="pi pi-chevron-down wp-iconpick__caret" aria-hidden="true" />
  </button>

  <Teleport to="body">
    <div
      v-if="open"
      ref="panelEl"
      class="wp-iconpick__panel"
      :style="{ top: pos.top + 'px', left: pos.left + 'px' }"
      role="listbox"
      :data-test="dataTest ? `${dataTest}-panel` : undefined"
    >
      <button
        type="button"
        class="wp-iconpick__clear"
        data-test="icon-picker-none"
        @click="pick(null)"
      >No icon</button>
      <div v-for="group in ICON_GROUPS" :key="group.label" class="wp-iconpick__group">
        <div class="wp-iconpick__group-label">{{ group.label }}</div>
        <div class="wp-iconpick__grid">
          <button
            v-for="name in group.icons"
            :key="name"
            type="button"
            class="wp-iconpick__cell"
            :class="{ 'wp-iconpick__cell--on': name === current }"
            role="option"
            :aria-selected="name === current"
            :title="name"
            :aria-label="name"
            :data-test="`icon-picker-${name}`"
            @click="pick(name)"
          ><i :class="`pi pi-${name}`" aria-hidden="true" /></button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wp-iconpick__trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--wp-space-2);
  height: var(--wp-input-h, 34px);
  padding: 0 var(--wp-space-3);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  color: var(--wp-text);
  cursor: pointer;
}
.wp-iconpick__trigger:hover { border-color: var(--wp-accent); }
.wp-iconpick__none { color: var(--wp-text-dim); }
.wp-iconpick__caret { font-size: 9px; color: var(--wp-text-dim); }
</style>

<style>
/* Unscoped: the panel is teleported to <body>, so a scoped selector's
   `[data-v-…]` attribute would never match it. Class names are
   component-specific (`wp-iconpick*`), so global is safe. */
.wp-iconpick__panel {
  position: fixed;
  z-index: 9999;
  width: 236px;
  max-height: 300px;
  overflow-y: auto;
  padding: var(--wp-space-3);
  background: var(--wp-bg-3);
  border: 1px solid var(--wp-border-strong);
  border-radius: var(--wp-radius);
  box-shadow: var(--wp-shadow-lg);
}
.wp-iconpick__clear {
  width: 100%;
  margin-bottom: var(--wp-space-3);
  padding: var(--wp-space-2);
  background: transparent;
  border: 1px dashed var(--wp-border);
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text-muted);
  font-size: var(--wp-text-xs);
  cursor: pointer;
}
.wp-iconpick__clear:hover { color: var(--wp-text); border-color: var(--wp-accent); }
.wp-iconpick__group + .wp-iconpick__group { margin-top: var(--wp-space-3); }
.wp-iconpick__group-label {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--wp-text-dim);
  margin-bottom: var(--wp-space-2);
}
.wp-iconpick__grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
}
.wp-iconpick__cell {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text-muted);
  cursor: pointer;
  font-size: 12px;
}
.wp-iconpick__cell:hover {
  background: color-mix(in oklab, var(--wp-accent) 18%, transparent);
  color: var(--wp-text);
}
.wp-iconpick__cell--on {
  border-color: var(--wp-accent);
  color: var(--wp-accent);
}
</style>
