<script setup lang="ts">
/**
 * The app pieces (`/kit`, linked from Settings › Advanced): parts built from
 * kit pieces that call the extension's own stores, live, with when to use
 * them. Every shared piece is on the wp-kit site (`KIT_SITE`), linked at the
 * top. Entries and their text live in `kit/registry.ts`;
 * `kit-coverage.test.ts` checks that every entry the manager can show has a
 * demo in `kit/demos/<id>.vue` and every kit-folder component has an entry.
 */
import { computed, type Component } from "vue";
import Banner from "../../kit/Banner.vue";
import KitEntry from "../kit/KitEntry.vue";
import { KIT_ENTRIES, KIT_GROUPS } from "../kit/registry";
import { KIT_SITE } from "../config/links";

// One demo file per entry, named after its id (`kit/demos/<id>.vue`), so
// PRs that add components don't all edit this file.
const DEMOS: Record<string, Component> = Object.fromEntries(
  Object.entries(import.meta.glob<Component>("../kit/demos/*.vue", { eager: true, import: "default" })).map(([path, c]) => [
    path.slice(path.lastIndexOf("/") + 1, -".vue".length),
    c,
  ]),
);

const groups = computed(() =>
  KIT_GROUPS.map((g) => ({ ...g, entries: KIT_ENTRIES.filter((e) => e.group === g.id) })),
);
</script>

<template>
  <div class="wp-page wp-kit" data-test="kit-page">
    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">Component kit</h1>
        <p class="wp-page__subtitle">
          The pieces only the extension has: parts built from the kit that work with your library. Building a
          screen? Reuse what is here and on the kit site.
        </p>
      </div>
    </div>

    <Banner tone="info" icon="pi pi-th-large" title="Every shared piece is on the kit site" note data-test="kit-site-banner">
      Buttons, fields, dropdowns, dialogs, menus, tables, the colours and the looks live in wp-kit, which the
      extension and the community site share. Its site shows each one live, in every palette and look.
      <template #actions>
        <a class="wp-btn wp-btn--primary wp-btn--md" :href="KIT_SITE" target="_blank" rel="noopener" data-test="kit-site-link">
          <i class="pi pi-external-link" aria-hidden="true" /> Open the kit site
        </a>
      </template>
    </Banner>

    <div class="wp-kit__main">
      <section v-for="g in groups" :id="`kit-group-${g.id}`" :key="g.id" class="wp-kit__group" :data-kit-group="g.id">
        <h2 class="wp-kit__group-title">{{ g.label }}</h2>
        <p class="wp-kit__group-blurb">{{ g.blurb }}</p>

        <template v-for="e in g.entries" :key="e.id">
          <KitEntry :id="e.id">
            <component :is="DEMOS[e.id]" v-if="DEMOS[e.id]" />
            <template v-else>
              <p class="wp-kit__muted" data-test="kit-canvas-only">
                Canvas only. Its stylesheet sets the canvas colours, so it is not shown here; open a WP node to see it.
              </p>
            </template>
          </KitEntry>
        </template>
      </section>
    </div>
  </div>
</template>

<style>
/* Not scoped: the demos in kit/demos use these helper classes. */
.wp-kit__main { margin-top: var(--wp-space-6); display: flex; flex-direction: column; gap: var(--wp-space-8); min-width: 0; }
.wp-kit__group { display: flex; flex-direction: column; gap: var(--wp-space-5); scroll-margin-top: 80px; }
.wp-kit__group-title { margin: 0; font-size: var(--wp-text-lg); font-weight: 600; color: var(--wp-text); }
.wp-kit__group-blurb { margin: calc(-1 * var(--wp-space-3)) 0 0; color: var(--wp-text-muted); font-size: var(--wp-text-sm); }
.wp-kit__stack { display: flex; flex-direction: column; gap: var(--wp-space-4); width: 100%; max-width: 420px; }
.wp-kit__stack--wide { max-width: 720px; }
.wp-kit__inline { display: inline-flex; align-items: center; gap: var(--wp-space-3); color: var(--wp-text); font-size: var(--wp-text-base); }
.wp-kit__muted { margin: 0; color: var(--wp-text-muted); font-size: var(--wp-text-sm); }
</style>
