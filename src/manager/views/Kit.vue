<script setup lang="ts">
/**
 * The component kit (`/kit`, linked from Settings › Advanced): every shared
 * control, live, with when to use it and how to write it. Entries and their
 * text live in `kit/registry.ts`; `kit-coverage.test.ts` checks that every
 * entry the manager can show has a demo in `kit/demos/<id>.vue` and every kit-folder
 * component has an entry.
 *
 * Canvas-only pieces (ModalShell, ContextMenu, the canvas toast) are not
 * mounted here: their stylesheet sets the canvas colours on :root and would
 * repaint the whole manager. Their entries show how to use them instead.
 */
import { computed, type Component } from "vue";
import KitEntry from "../kit/KitEntry.vue";
import KitTokens from "../kit/KitTokens.vue";
import { KIT_ENTRIES, KIT_GROUPS } from "../kit/registry";

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
          Every shared control, in the current theme. Building a screen? Use what is here. When nothing fits,
          make the new component in a kit folder and add it to this page.
        </p>
      </div>
    </div>

    <div class="wp-kit__layout">
      <nav class="wp-kit__nav" aria-label="Kit sections">
        <a href="#kit-tokens" class="wp-kit__nav-link">Tokens</a>
        <template v-for="g in groups" :key="g.id">
          <a :href="`#kit-group-${g.id}`" class="wp-kit__nav-link">{{ g.label }}</a>
          <a v-for="e in g.entries" :key="e.id" :href="`#kit-${e.id}`" class="wp-kit__nav-link wp-kit__nav-link--sub">{{ e.name }}</a>
        </template>
      </nav>

      <div class="wp-kit__main">
        <section class="wp-kit__group">
          <h2 class="wp-kit__group-title">Tokens</h2>
          <p class="wp-kit__group-blurb">Colours, type and spacing. Use a token, never a raw colour or size.</p>
          <KitTokens />
        </section>

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
  </div>
</template>

<style>
/* Not scoped: the demos in kit/demos use these helper classes. */
.wp-kit__layout {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: var(--wp-space-7);
  align-items: start;
}
.wp-content[data-lt~="900"] .wp-kit__layout { grid-template-columns: minmax(0, 1fr); }
.wp-content[data-lt~="900"] .wp-kit__nav { display: none; }
.wp-kit__nav {
  position: sticky;
  top: var(--wp-space-6);
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
}
.wp-kit__nav-link {
  padding: 4px 8px;
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font-size: var(--wp-text-sm);
  font-weight: 600;
  text-decoration: none;
}
.wp-kit__nav-link--sub { font-weight: 400; color: var(--wp-text-muted); padding-left: 16px; }
.wp-kit__nav-link:hover { background: var(--wp-bg-3); color: var(--wp-text); }
.wp-kit__main { display: flex; flex-direction: column; gap: var(--wp-space-8); min-width: 0; }
.wp-kit__group { display: flex; flex-direction: column; gap: var(--wp-space-5); scroll-margin-top: 80px; }
.wp-kit__group-title { margin: 0; font-size: var(--wp-text-lg); font-weight: 600; color: var(--wp-text); }
.wp-kit__group-blurb { margin: calc(-1 * var(--wp-space-3)) 0 0; color: var(--wp-text-muted); font-size: var(--wp-text-sm); }
.wp-kit__stack { display: flex; flex-direction: column; gap: var(--wp-space-4); width: 100%; max-width: 420px; }
.wp-kit__stack--wide { max-width: 720px; }
.wp-kit__row { display: flex; align-items: center; gap: var(--wp-space-4); flex-wrap: wrap; }
.wp-kit__inline { display: inline-flex; align-items: center; gap: var(--wp-space-3); color: var(--wp-text); font-size: var(--wp-text-base); }
.wp-kit__muted { margin: 0; color: var(--wp-text-muted); font-size: var(--wp-text-sm); }
.wp-kit__compact { width: 160px; height: 28px; }
.wp-kit__hsv { width: 240px; }
.wp-kit__menu-col { display: flex; flex-direction: column; gap: var(--wp-space-2); min-width: 180px; }
.wp-kit__target {
  display: grid; place-items: center; width: 100%; max-width: 420px; height: 96px;
  border: 1px dashed var(--wp-border-strong); border-radius: var(--wp-radius-md);
  background: transparent; color: var(--wp-text-muted); font: inherit; font-size: var(--wp-text-sm); cursor: context-menu;
}
.wp-kit__canvas-dialog {
  display: flex; flex-direction: column; align-items: flex-start; gap: 12px; max-width: 360px; padding: 16px;
  background: var(--wp-bg2); border: 1px solid var(--wp-border); border-radius: var(--wp-radius); color: var(--wp-text); font-size: 12px;
}
.wp-kit__list { margin: 0; padding-left: 18px; color: var(--wp-text-muted); font-size: var(--wp-text-sm); }
.wp-kit__icons {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: var(--wp-space-3);
}
.wp-kit__icons li {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: var(--wp-space-3); color: var(--wp-text); font-size: var(--wp-text-xs);
}
.wp-kit__icons span { color: var(--wp-text-dim); font-family: var(--wp-font-mono); }
</style>
