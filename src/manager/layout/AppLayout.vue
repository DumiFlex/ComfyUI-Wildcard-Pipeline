<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterView } from "vue-router";
import AppTopbar from "./AppTopbar.vue";
import AppSidebar from "./AppSidebar.vue";
import ToastHost from "../components/ui/ToastHost.vue";
import TweaksPanel from "../components/TweaksPanel.vue";
import CommandPalette from "../components/CommandPalette.vue";
import ShortcutsHelp from "../components/ShortcutsHelp.vue";
import { useUiStore } from "../stores/uiStore";
import { useCommandIndex } from "../composables/useCommandIndex";
import { useRecentStore } from "../stores/recentStore";
import { useModuleStore } from "../stores/moduleStore";
import { useBundleStore } from "../stores/bundleStore";
import { useTemplateStore } from "../stores/templateStore";
import { useCategoryStore } from "../stores/categoryStore";
import { useCascadeStore } from "../cascade/cascade-store";
import {
  hashes as libraryHashes,
  bundleHashes as libraryBundleHashes,
  subscribe as subscribeDrift,
  unsubscribe as unsubscribeDrift,
} from "../../components/context/drift-store";

const ui = useUiStore();
const commandIndex = useCommandIndex();
const recent = useRecentStore();
const moduleStore = useModuleStore();
const bundleStore = useBundleStore();
const templateStore = useTemplateStore();
const categoryStore = useCategoryStore();
const cascadeStore = useCascadeStore();

const paletteOpen = ref(false);
const shortcutsOpen = ref(false);

/** Predicate: target is a typing surface where global single-modifier
 *  shortcuts should defer to the input. Cmd+K and Cmd+/ still fire —
 *  those are deliberately global — but Cmd+B (sidebar toggle) and
 *  similar should pass through if the user is typing. */
function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea") return true;
  if (el.isContentEditable) return true;
  return false;
}

/** Compact fingerprint of a hashes map — sorted "id:hash" pairs joined.
 *  Changes when ANY key is added, removed, or its hash flips. Returns
 *  empty string while the polled map is still null (first fetch in
 *  flight) so the watcher doesn't fire on transition-to-loaded. */
function hashesFingerprint(map: Record<string, string> | null): string {
  if (map === null) return "";
  const keys = Object.keys(map).sort();
  if (keys.length === 0) return "empty";
  return keys.map((k) => `${k}:${map[k]}`).join("|");
}

function onKeydown(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey)) return;
  const key = e.key.toLowerCase();

  // Palette — Cmd/Ctrl + K. Suppress while typing so editor finds /
  // replaces aren't hijacked.
  if (key === "k") {
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    paletteOpen.value = !paletteOpen.value;
    return;
  }

  // Shortcut help — Cmd/Ctrl + /. Fires from anywhere; '/' isn't a
  // common in-editor binding so global wins.
  if (key === "/") {
    e.preventDefault();
    shortcutsOpen.value = !shortcutsOpen.value;
    return;
  }

  // Sidebar toggle — Cmd/Ctrl + B. Skip while typing (Bold etc.).
  if (key === "b") {
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    ui.toggleSidebar();
    return;
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  // Eager-fetch the three library stores so sidebar count badges,
  // Cmd+K palette index, and Recents section have real data on cold
  // load. Dashboard fetches via api.* directly and does not touch
  // these stores; list views fetch lazily on mount but only after the
  // user navigates to them. AppLayout mounts once for the entire SPA
  // lifetime, so this is a one-time cost per app load.
  // After all three fetches complete, bootstrap the cascade reverse-dep
  // index so PillCountBadges in editors show real counts immediately.
  // Errors on individual fetches are swallowed — the lazy list-view
  // fetches still run on actual usage if a fetch fails here.
  Promise.all([
    moduleStore.fetchCatalog().catch(() => undefined),
    bundleStore.fetchCatalog().catch(() => undefined),
    templateStore.fetchCatalog().catch(() => undefined),
    categoryStore.fetchAll().catch(() => undefined),
  ]).then(() => {
    const catalog = moduleStore.catalog;
    cascadeStore.rebuild({
      wildcards: catalog.filter((m) => m.type === "wildcard").map((m) => ({
        id: m.id, name: m.name, payload: m.payload ?? {}, category_id: m.category_id,
      })),
      fixed_values: catalog.filter((m) => m.type === "fixed_values").map((m) => ({
        id: m.id, name: m.name, payload: m.payload ?? {}, category_id: m.category_id,
      })),
      combines: catalog.filter((m) => m.type === "combine").map((m) => ({
        id: m.id, name: m.name, payload: m.payload ?? {}, category_id: m.category_id,
      })),
      derivations: catalog.filter((m) => m.type === "derivation").map((m) => ({
        id: m.id, name: m.name, payload: m.payload ?? {}, category_id: m.category_id,
      })),
      constraints: catalog.filter((m) => m.type === "constraint").map((m) => ({
        id: m.id, name: m.name, payload: m.payload ?? {},
      })),
      bundles: bundleStore.catalog.map((b) => ({
        id: b.id, name: b.name,
        children: (b.children ?? []) as Array<{ id: string; type: string }>,
      })),
      categories: categoryStore.items.map((c) => ({ id: c.id, name: c.name })),
    });
  }).catch(() => undefined);

  // Live-refresh sidebar count badges + catalogs whenever the drift
  // store's polled hash maps change (insert/delete/update from any
  // surface — graph-side ContextWidget writes, SPA edits, external
  // tools). The store polls every 5s; we react to ANY hash-map delta
  // (keys OR values) so renames/payload edits propagate too, rather
  // than wiring explicit pub/sub into every mutation site.
  // subscribe() is ref-counted so this is safe alongside ContextWidget.
  //
  // Guard: skip the first non-empty transition (prev === "" means the
  // poll just landed for the first time). The onMounted fetchCatalog
  // above already covers cold-load; firing again here would race that
  // request and double-mutate catalog.value mid-render — Vue's patcher
  // observed a null parentNode on insertBefore in the wild.
  subscribeDrift();
  watch(
    () => hashesFingerprint(libraryHashes.value),
    (next, prev) => {
      if (prev === undefined || prev === "" || next === prev) return;
      moduleStore.fetchCatalog().catch(() => undefined);
    },
  );
  watch(
    () => hashesFingerprint(libraryBundleHashes.value),
    (next, prev) => {
      if (prev === undefined || prev === "" || next === prev) return;
      bundleStore.fetchCatalog().catch(() => undefined);
    },
  );
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  unsubscribeDrift();
});
</script>

<template>
  <div class="wp-app">
    <a href="#wp-main" class="wp-skip-link">Skip to main content</a>
    <AppTopbar />
    <div class="wp-body" :data-collapsed="ui.sidebarCollapsed || undefined">
      <AppSidebar />
      <main id="wp-main" class="wp-content" tabindex="-1">
        <RouterView v-slot="{ Component, route }">
          <Transition name="route-fade" mode="out-in">
            <component :is="Component" :key="route.path" />
          </Transition>
        </RouterView>
      </main>
    </div>
    <ToastHost />
    <TweaksPanel />
    <CommandPalette v-model:open="paletteOpen" :items="commandIndex" :recent-ids="recent.recentIds" />
    <ShortcutsHelp v-model:open="shortcutsOpen" />
  </div>
</template>
