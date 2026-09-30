<script setup lang="ts">
/**
 * Settings — a section nav on the left (with search), one section at a time
 * on the right. The page used to be a single ~3,500px column of cards; now
 * each section is short enough to take in at a glance, and search reaches any
 * setting by name.
 *
 * The section is part of the URL (`/settings/<section>`, `#<setting>` for a
 * search hit), so links, the command palette and the back button all work.
 * Every row a search can land on is listed in `settings-index.ts`.
 */
import { computed, nextTick, ref, watch, type Component } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import Icon from "../components/ui/Icon.vue";
import GeneralSection from "../components/settings/sections/GeneralSection.vue";
import AppearanceSection from "../components/settings/sections/AppearanceSection.vue";
import EditingSection from "../components/settings/sections/EditingSection.vue";
import AutocompleteSection from "../components/settings/sections/AutocompleteSection.vue";
import CanvasSection from "../components/settings/sections/CanvasSection.vue";
import TestRunnerSection from "../components/settings/sections/TestRunnerSection.vue";
import LibrarySection from "../components/settings/sections/LibrarySection.vue";
import AdvancedSection from "../components/settings/sections/AdvancedSection.vue";
import {
  SECTIONS,
  isSectionId,
  searchSettings,
  type SectionId,
  type SettingEntry,
} from "../components/settings/settings-index";

const props = defineProps<{ section?: string }>();

const route = useRoute();
const router = useRouter();

const COMPONENTS: Record<SectionId, Component> = {
  general: GeneralSection,
  appearance: AppearanceSection,
  editing: EditingSection,
  autocomplete: AutocompleteSection,
  canvas: CanvasSection,
  "test-runner": TestRunnerSection,
  library: LibrarySection,
  advanced: AdvancedSection,
};

const active = computed<SectionId>(() => (isSectionId(props.section) ? props.section : "general"));
const activeDef = computed(() => SECTIONS.find((s) => s.id === active.value) ?? SECTIONS[0]);

const query = ref("");
const results = computed<SettingEntry[]>(() => searchSettings(query.value));
const searching = computed(() => query.value.trim().length > 0);

function sectionLabel(id: SectionId): string {
  return SECTIONS.find((s) => s.id === id)?.label ?? id;
}

function openResult(e: SettingEntry): void {
  query.value = "";
  void router.push({ name: "settings", params: { section: e.section }, hash: `#${e.key}` });
}

function onSearchKey(ev: KeyboardEvent): void {
  if (ev.key === "Enter" && results.value[0]) openResult(results.value[0]);
  if (ev.key === "Escape") query.value = "";
}

/** Bring a search target into view once its section has rendered. Sections
 *  load their data asynchronously, so retry briefly until the row exists. */
async function revealHash(): Promise<void> {
  const id = route.hash.slice(1);
  if (!id) return;
  for (let attempt = 0; attempt < 20; attempt++) {
    await nextTick();
    const el = document.getElementById(id);
    if (el) {
      if (el instanceof HTMLDetailsElement) el.open = true;
      el.scrollIntoView?.({ block: "center", behavior: "smooth" });
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

watch(() => [active.value, route.hash], () => { void revealHash(); }, { immediate: true });
</script>

<template>
  <div class="wp-page wp-settings">
    <aside class="wp-settings__nav" aria-label="Settings sections">
      <h1 class="wp-settings__title">Settings</h1>
      <div class="wp-settings__search">
        <Icon name="pi-search" />
        <input
          v-model="query"
          type="search"
          placeholder="Search settings"
          aria-label="Search settings"
          data-test="settings-search"
          @keydown="onSearchKey"
        >
      </div>
      <nav class="wp-settings__sections">
        <RouterLink
          v-for="s in SECTIONS"
          :key="s.id"
          :to="{ name: 'settings', params: { section: s.id } }"
          class="wp-settings__section-link"
          :data-active="!searching && s.id === active ? 'true' : 'false'"
          :aria-current="!searching && s.id === active ? 'page' : undefined"
          :data-test="`settings-nav-${s.id}`"
        >
          <Icon :name="s.icon" />{{ s.label }}
        </RouterLink>
      </nav>
    </aside>

    <main class="wp-settings__main">
      <template v-if="searching">
        <header class="wp-settings__head">
          <h2 class="wp-settings__h2">
            {{ results.length }} {{ results.length === 1 ? "result" : "results" }} for “{{ query.trim() }}”
          </h2>
          <p class="wp-settings__blurb">Enter opens the first one.</p>
        </header>
        <ul v-if="results.length" class="wp-settings__results" data-test="settings-results">
          <li v-for="r in results" :key="r.key">
            <button type="button" class="wp-settings__result" :data-test="`settings-result-${r.key}`" @click="openResult(r)">
              <span class="wp-settings__result-where">{{ sectionLabel(r.section) }}</span>
              <span class="wp-settings__result-label">{{ r.label }}</span>
              <span class="wp-settings__result-hint">{{ r.hint }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="wp-settings__blurb">Nothing matches. Try a shorter word.</p>
      </template>
      <template v-else>
        <header class="wp-settings__head">
          <h2 class="wp-settings__h2">{{ activeDef.label }}</h2>
          <p class="wp-settings__blurb">{{ activeDef.blurb }}</p>
        </header>
        <component :is="COMPONENTS[active]" :key="active" />
      </template>
    </main>
  </div>
</template>

<style scoped>
.wp-settings {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: var(--wp-space-8, 32px);
  align-items: start;
  max-width: 1080px;
}
.wp-settings__nav {
  position: sticky;
  top: var(--wp-space-6);
}
.wp-settings__title { font-size: 20px; margin: 0 0 var(--wp-space-5); }
.wp-settings__search {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border-strong, var(--wp-border));
  border-radius: var(--wp-radius);
  padding: 0 var(--wp-space-4);
  color: var(--wp-text-dim);
  margin-bottom: var(--wp-space-5);
}
.wp-settings__search:focus-within { border-color: var(--wp-accent-500); }
.wp-settings__search input {
  flex: 1;
  min-width: 0;
  height: 32px;
  border: 0;
  background: transparent;
  color: var(--wp-text);
  font: inherit;
  font-size: var(--wp-text-sm);
  outline: none;
}
.wp-settings__sections { display: flex; flex-direction: column; gap: 2px; }
.wp-settings__section-link {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  padding: 7px var(--wp-space-4);
  border-radius: var(--wp-radius);
  color: var(--wp-text-muted);
  text-decoration: none;
  font-size: var(--wp-text-sm);
}
.wp-settings__section-link:hover { color: var(--wp-text); background: var(--wp-bg-3); }
.wp-settings__section-link[data-active="true"] {
  background: color-mix(in oklab, var(--wp-accent-500) 18%, transparent);
  color: var(--wp-accent-text);
  font-weight: 600;
}
.wp-settings__main { min-width: 0; max-width: 780px; }
.wp-settings__head { margin-bottom: var(--wp-space-6); }
.wp-settings__h2 { font-size: 18px; margin: 0; }
.wp-settings__blurb { margin: 4px 0 0; font-size: var(--wp-text-sm); color: var(--wp-text-dim); }
.wp-settings__results { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--wp-space-3); }
.wp-settings__result {
  width: 100%;
  display: grid;
  gap: 2px;
  text-align: left;
  padding: var(--wp-space-4) var(--wp-space-5);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg, 10px);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.wp-settings__result:hover { border-color: var(--wp-accent-500); }
.wp-settings__result-where { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--wp-text-dim); }
.wp-settings__result-label { font-weight: 600; font-size: var(--wp-text-sm); }
.wp-settings__result-hint { font-size: 12px; color: var(--wp-text-dim); }

@media (max-width: 860px) {
  .wp-settings { grid-template-columns: minmax(0, 1fr); gap: var(--wp-space-5); }
  .wp-settings__nav { position: static; }
  .wp-settings__sections { flex-direction: row; flex-wrap: wrap; }
}
</style>

<style>
/* Shared by every Settings section (they are separate SFCs, so scoped styles
 * cannot reach across). Prefixed, per the extension's CSS isolation rule. */
.wp-set-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  line-height: 1.6;
  padding: 1px 9px;
  border-radius: 999px;
  border: 1px solid var(--wp-border-strong, var(--wp-border));
  color: var(--wp-text-muted);
  white-space: nowrap;
}
.wp-set-pill::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.8;
}
.wp-set-pill[data-tone="ok"] { color: var(--wp-success); border-color: color-mix(in oklab, var(--wp-success) 40%, transparent); }
.wp-set-pill[data-tone="warn"] { color: var(--wp-warn); border-color: color-mix(in oklab, var(--wp-warn) 40%, transparent); }
.wp-set-error { margin: 0 0 var(--wp-space-5); font-size: var(--wp-text-sm); color: var(--wp-danger, #f87171); }
.wp-set-callout {
  margin: 0 0 var(--wp-space-6);
  padding: var(--wp-space-4) var(--wp-space-5);
  font-size: var(--wp-text-sm);
  color: var(--wp-accent-text);
  background: color-mix(in oklab, var(--wp-accent-500) 10%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 35%, transparent);
  border-radius: var(--wp-radius);
}
</style>
