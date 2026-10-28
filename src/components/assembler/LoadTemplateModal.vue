<script setup lang="ts">
/**
 * LoadTemplateModal — library browser for the PromptAssembler "Load"
 * button. Adapts the layout + visual language of ModulePickerModal
 * (header, search toolbar, category/tags filter popover, scrollable
 * rows) but specialised for templates: single-click picks a row and
 * closes (no multi-select / kind tabs / payload gating). Emits the full
 * row so the assembler can persist the load identity for round-trip
 * "Update existing" saves.
 */
import SearchInput from "../shared/SearchInput.vue";
import { computed, nextTick, ref, watch } from "vue";
import WpSelect from "../shared/WpSelect.vue";
import { api } from "../../manager/api/client";
import type { TemplateRow } from "../../manager/api/types";
import ModalShell from "../shared/ModalShell.vue";
import LoadingMark from "../shared/LoadingMark.vue";
import CloseButton from "../shared/CloseButton.vue";
import WpButton from "../shared/WpButton.vue";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; pick: [TemplateRow] }>();

const rows = ref<TemplateRow[]>([]);
const categories = ref<{ id: string; name: string }[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);

const searchTerm = ref("");
const searchInput = ref<InstanceType<typeof SearchInput> | null>(null);
const favoritesOnly = ref(false);
const selectedCategoryId = ref<string | null>(null);
const selectedTags = ref<Set<string>>(new Set());
const filtersOpen = ref(false);

/** Tags surfaced by the loaded library, deduped + sorted. */
const availableTags = computed<string[]>(() => {
  const set = new Set<string>();
  for (const r of rows.value) for (const t of r.tags) if (t) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
});

/** Categories actually referenced by a template, name-resolved. */
const usedCategories = computed<{ id: string; name: string }[]>(() => {
  const used = new Set<string>();
  for (const r of rows.value) if (r.category_id) used.add(r.category_id);
  return categories.value
    .filter((c) => used.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name));
});

const activePopoverCount = computed<number>(
  () => (selectedCategoryId.value !== null ? 1 : 0) + selectedTags.value.size,
);
const hasActiveFilter = computed(
  () => favoritesOnly.value
    || selectedTags.value.size > 0
    || selectedCategoryId.value !== null
    || !!searchTerm.value.trim(),
);

const filtered = computed<TemplateRow[]>(() => {
  const needle = searchTerm.value.trim().toLowerCase();
  const tagFilter = selectedTags.value;
  return rows.value.filter((r) => {
    if (favoritesOnly.value && !r.is_favorite) return false;
    if (selectedCategoryId.value !== null && r.category_id !== selectedCategoryId.value) return false;
    if (tagFilter.size > 0) {
      for (const t of tagFilter) if (!r.tags.includes(t)) return false;
    }
    if (!needle) return true;
    return r.name.toLowerCase().includes(needle)
      || r.template_string.toLowerCase().includes(needle);
  });
});

const categoryNameById = computed<Map<string, string>>(
  () => new Map(categories.value.map((c) => [c.id, c.name])),
);

function toggleTag(tag: string) {
  const next = new Set(selectedTags.value);
  if (next.has(tag)) next.delete(tag);
  else next.add(tag);
  selectedTags.value = next;
}

function clearAllFilters() {
  favoritesOnly.value = false;
  selectedTags.value = new Set();
  selectedCategoryId.value = null;
  searchTerm.value = "";
}

async function reload() {
  loading.value = true;
  loadError.value = null;
  const [tpls, cats] = await Promise.allSettled([
    api.templates.list({}),
    api.categories.list(),
  ]);
  if (tpls.status === "fulfilled") {
    rows.value = tpls.value.items;
  } else {
    rows.value = [];
    loadError.value = "Could not load templates.";
  }
  categories.value = cats.status === "fulfilled" ? cats.value.items : [];
  loading.value = false;
}

watch(() => props.open, (open) => {
  if (!open) return;
  searchTerm.value = "";
  favoritesOnly.value = false;
  selectedCategoryId.value = null;
  selectedTags.value = new Set();
  filtersOpen.value = false;
  void reload();
  void nextTick(() => searchInput.value?.focus());
}, { immediate: true });

function pick(row: TemplateRow) {
  emit("pick", row);
  emit("close");
}
</script>

<template>
  <ModalShell :visible="open" @close="emit('close')">
    <div class="wp-ltm" role="dialog" aria-modal="true" aria-labelledby="wp-ltm-title" @click.stop>
      <header class="wp-ltm__head">
        <div class="wp-ltm__head-text">
          <div class="wp-ltm__eyebrow">Load template from library</div>
          <div id="wp-ltm-title" class="wp-ltm__title">
            Browse Templates
            <span class="wp-ltm__title-detail">· {{ rows.length }} {{ rows.length === 1 ? "template" : "templates" }}</span>
          </div>
        </div>
        <CloseButton size="sm" kbd="Esc" data-test="load-tpl-close" @click="emit('close')" />
      </header>

      <div class="wp-ltm__toolbar">
        <SearchInput
          ref="searchInput"
          v-model="searchTerm"
          class="wp-ltm__search"
          size="sm"
          placeholder="Search templates by name or text…"
          aria-label="Search templates"
          data-test="load-tpl-search"
        />

        <WpButton
          variant="outline"
          :icon="favoritesOnly ? 'pi-star-fill' : 'pi-star'"
          :pressed="favoritesOnly"
          :aria-label="favoritesOnly ? 'Showing favorites only, click to clear' : 'Show favorites only'"
          data-test="load-tpl-favorites"
          @click="favoritesOnly = !favoritesOnly"
        />

        <div class="wp-ltm__filters-pop">
          <WpButton
            variant="outline"
            icon="pi-filter"
            :pressed="activePopoverCount > 0 || filtersOpen"
            :aria-expanded="filtersOpen"
            aria-label="Filters"
            :hint="filtersOpen ? 'Close filters' : 'More filters'"
            data-test="load-tpl-filter-trigger"
            @click="filtersOpen = !filtersOpen"
          />
          <span v-if="activePopoverCount > 0" class="wp-ltm__filter-badge">{{ activePopoverCount }}</span>

          <Transition name="wp-pop">
            <div v-if="filtersOpen" class="wp-ltm__pop">
              <div v-if="!usedCategories.length && !availableTags.length" class="wp-ltm__pop-empty">
                No categories or tags on saved templates yet.
              </div>
              <div v-if="usedCategories.length" class="wp-ltm__pop-section">
                <div class="wp-ltm__pop-label">CATEGORY</div>
                <WpSelect
                  class="wp-ltm__cat-select"
                  :model-value="selectedCategoryId ?? ''"
                  :options="[{ value: '', label: 'All categories' }, ...usedCategories.map((c) => ({ value: c.id, label: c.name }))]"
                  aria-label="Filter by category"
                  data-test="load-tpl-filter-category"
                  @update:model-value="(v) => selectedCategoryId = String(v) || null"
                />
              </div>
              <div v-if="availableTags.length" class="wp-ltm__pop-section">
                <div class="wp-ltm__pop-label">TAGS <span class="wp-ltm__pop-hint">click to AND-narrow</span></div>
                <div class="wp-ltm__filter-tags">
                  <button
                    v-for="tag in availableTags"
                    :key="tag"
                    type="button"
                    class="wp-ltm__tag-chip"
                    :class="{ 'wp-ltm__tag-chip--active': selectedTags.has(tag) }"
                    @click="toggleTag(tag)"
                  >{{ tag }}</button>
                </div>
              </div>
              <WpButton
                v-if="hasActiveFilter"
                variant="ghost"
                icon="pi-filter-slash"
                @click="clearAllFilters"
              >Clear all filters</WpButton>
            </div>
          </Transition>
        </div>
      </div>

      <div v-if="filtersOpen" class="wp-ltm__pop-shield" @click="filtersOpen = false" />

      <div class="wp-ltm__body">
        <div v-if="loading" class="wp-ltm__state" aria-busy="true">
          <LoadingMark block :size="32">Loading templates…</LoadingMark>
        </div>
        <div v-else-if="loadError" class="wp-ltm__state wp-ltm__state--error">
          <i class="pi pi-exclamation-triangle" aria-hidden="true" />
          {{ loadError }}
          <WpButton @click="reload">Retry</WpButton>
        </div>
        <div v-else-if="filtered.length === 0" class="wp-ltm__state">
          <i class="pi pi-inbox" aria-hidden="true" />
          {{ searchTerm || hasActiveFilter ? "No templates match these filters." : "No saved templates — use Save on an assembler to create one." }}
        </div>

        <template v-else>
          <button
            v-for="row in filtered"
            :key="row.id"
            type="button"
            class="wp-ltm__row"
            data-test="load-tpl-row"
            :data-testid="`load-tpl-row-${row.id}`"
            @click="pick(row)"
          >
            <span class="wp-ltm__row-icon"><i class="pi pi-file-edit" aria-hidden="true" /></span>
            <span class="wp-ltm__row-main">
              <span class="wp-ltm__row-name">
                {{ row.name }}
                <i v-if="row.is_favorite" class="pi pi-star-fill wp-ltm__row-fav" aria-hidden="true" />
              </span>
              <span class="wp-ltm__row-preview" :title="row.template_string">{{ row.template_string || "(empty)" }}</span>
              <span
                v-if="row.negative_template"
                class="wp-ltm__row-preview wp-ltm__row-preview--neg"
                data-test="load-tpl-row-neg"
                :title="row.negative_template"
              >neg: {{ row.negative_template }}</span>
            </span>
            <span v-if="row.category_id && categoryNameById.get(row.category_id)" class="wp-ltm__row-cat">
              {{ categoryNameById.get(row.category_id) }}
            </span>
          </button>
        </template>
      </div>

      <footer class="wp-ltm__foot">
        <span class="wp-ltm__hint">Click a template to load it into the assembler.</span>
        <span class="wp-ltm__foot-spacer" />
        <WpButton data-test="load-tpl-cancel" @click="emit('close')">Cancel</WpButton>
      </footer>
    </div>
  </ModalShell>
</template>

<style scoped>
.wp-ltm {
  background: var(--wp-bg-2, #15151f);
  border: 1px solid var(--wp-border-strong, var(--wp-border));
  border-radius: var(--wp-radius-lg, 12px);
  box-shadow: var(--wp-shadow-lg, 0 20px 60px rgba(0, 0, 0, 0.55));
  width: 640px;
  max-width: calc(100vw - 32px);
  height: 560px;
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  color: var(--wp-text);
  overflow: hidden;
  font-family: var(--wp-font-sans, sans-serif);
}

/* Header — brand wash mirrors ModulePickerModal. */
.wp-ltm__head {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--wp-border);
  background: var(--wp-brand-gradient, transparent);
  position: relative;
}
.wp-ltm__head::after {
  content: "";
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--wp-bg) 85%, transparent);
  pointer-events: none;
}
.wp-ltm__head > * { position: relative; z-index: 1; }
.wp-ltm__head-text { flex: 1; min-width: 0; }
.wp-ltm__eyebrow {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--wp-text-muted);
  font-weight: 600;
}
.wp-ltm__title { font-size: 14px; font-weight: 600; color: var(--wp-text); margin-top: 1px; }
.wp-ltm__title-detail { font-size: 11.5px; color: var(--wp-text-dim); margin-left: 6px; font-weight: 400; }

/* Toolbar */
.wp-ltm__toolbar {
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid var(--wp-border);
}
.wp-ltm__search { flex: 1; }

.wp-ltm__filter-badge {
  position: absolute; top: -4px; right: -4px;
  min-width: 14px; height: 14px; padding: 0 3px;
  border-radius: 7px;
  background: var(--wp-amber, #ffd400); color: #000;
  font-family: var(--wp-font-mono, monospace);
  font-size: 9px; font-weight: 700; line-height: 14px; text-align: center;
  pointer-events: none;
}

.wp-ltm__filters-pop { position: relative; display: inline-flex; }
.wp-ltm__pop {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 10;
  min-width: 260px; max-width: 340px;
  background: var(--wp-bg2, var(--wp-bg-2));
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius, 8px);
  box-shadow: var(--wp-shadow-md, 0 6px 20px rgba(0, 0, 0, 0.45));
  padding: 10px;
  display: flex; flex-direction: column; gap: 10px;
}
.wp-ltm__pop-section { display: flex; flex-direction: column; gap: 6px; }
.wp-ltm__pop-label {
  display: flex; align-items: baseline; gap: 8px;
  font-size: 9px; font-family: var(--wp-font-mono, monospace);
  color: var(--wp-text3, var(--wp-text-dim)); letter-spacing: 0.08em; font-weight: 600;
}
.wp-ltm__pop-hint { font-weight: 400; letter-spacing: 0; font-style: italic; }
.wp-ltm__pop-empty { font-size: 11px; color: var(--wp-text-dim); padding: 2px 0; }
.wp-ltm__cat-select { width: 100%; height: 28px; }
.wp-ltm__filter-tags { display: flex; flex-wrap: wrap; gap: 4px; max-height: 180px; overflow-y: auto; }
.wp-ltm__tag-chip {
  display: inline-flex; align-items: center;
  background: transparent;
  border: 1px solid var(--wp-border);
  border-radius: 999px;
  color: var(--wp-text3, var(--wp-text-dim));
  font-family: var(--wp-font-mono, monospace);
  font-size: 10px; font-weight: 600;
  padding: 2px 8px; cursor: pointer;
  transition: background var(--wp-motion-quick), color var(--wp-motion-quick), border-color var(--wp-motion-quick);
}
.wp-ltm__tag-chip:hover { color: var(--wp-text); border-color: var(--wp-border-strong); }
.wp-ltm__tag-chip--active {
  background: color-mix(in srgb, var(--wp-accent) 18%, transparent);
  border-color: var(--wp-accent); color: var(--wp-accent);
}
.wp-ltm__pop-shield { position: absolute; inset: 0; z-index: 5; }
.wp-pop-enter-active, .wp-pop-leave-active {
  transition: opacity var(--wp-motion-quick), transform var(--wp-motion-quick);
  transform-origin: top right;
}
.wp-pop-enter-from, .wp-pop-leave-to { opacity: 0; transform: scale(0.96) translateY(-2px); }

/* Body / rows */
.wp-ltm__body { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 8px 8px; }
.wp-ltm__state {
  padding: 36px 16px; text-align: center;
  color: var(--wp-text-muted); font-size: 12.5px;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.wp-ltm__state .pi { font-size: 18px; color: var(--wp-text-dim); }
.wp-ltm__state--error { color: var(--wp-danger, #fca5a5); }

.wp-ltm__row {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--wp-text);
  cursor: pointer;
  text-align: left;
  transition: background var(--wp-motion-quick) ease, border-color var(--wp-motion-quick) ease;
}
.wp-ltm__row:hover { background: var(--wp-bg-3); border-color: var(--wp-border); }
.wp-ltm__row:focus-visible {
  outline: none;
  background: var(--wp-bg-3);
  box-shadow: inset 0 0 0 1.5px var(--wp-accent-500, var(--wp-accent));
}
.wp-ltm__row-icon {
  width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 4px;
  background: color-mix(in srgb, var(--wp-accent) 14%, transparent);
  color: var(--wp-accent);
  flex-shrink: 0;
}
.wp-ltm__row-icon .pi { font-size: 11px; }
.wp-ltm__row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wp-ltm__row-name {
  font-size: 12.5px; font-weight: 600;
  display: inline-flex; align-items: center; gap: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wp-ltm__row-fav { font-size: 9px; color: var(--wp-amber, #ffd400); }
.wp-ltm__row-preview {
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  color: var(--wp-text-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wp-ltm__row-preview--neg { color: color-mix(in srgb, var(--wp-danger) 75%, var(--wp-text-muted)); }
.wp-ltm__row-cat {
  font-size: 10px;
  color: var(--wp-text-dim);
  background: var(--wp-bg-2, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: 999px;
  padding: 1px 8px;
  white-space: nowrap;
  flex-shrink: 0;
}

/* Footer */
.wp-ltm__foot {
  height: 44px; padding: 0 16px;
  display: flex; align-items: center; gap: 10px;
  border-top: 1px solid var(--wp-border);
  background: var(--wp-bg-1);
  color: var(--wp-text-dim); font-size: 11px;
}
.wp-ltm__foot-spacer { flex: 1; }
</style>
