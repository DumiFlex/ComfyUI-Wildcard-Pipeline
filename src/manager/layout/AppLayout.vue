<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterView } from "vue-router";
import AppTopbar from "./AppTopbar.vue";
import AppSidebar from "./AppSidebar.vue";
import StaleBanner from "../components/StaleBanner.vue";
import ErrorBoundary from "../components/ErrorBoundary.vue";
import ToastHost from "../components/ui/ToastHost.vue";
import TweaksPanel from "../components/TweaksPanel.vue";
import CommandPalette from "../components/CommandPalette.vue";
import ShortcutsHelp from "../components/ShortcutsHelp.vue";
import { useUiStore } from "../stores/uiStore";
import { useCommandIndex } from "../composables/useCommandIndex";
import { useRecentStore } from "../stores/recentStore";
import { useStaleStore } from "../stores/staleStore";
import { useSystemStore } from "../stores/systemStore";
import { useModuleStore } from "../stores/moduleStore";
import { useBundleStore } from "../stores/bundleStore";
import { useTemplateStore } from "../stores/templateStore";
import { useCategoryStore } from "../stores/categoryStore";
import { useCascadeStore } from "../cascade/cascade-store";
import { api } from "../api/client";
import {
  hashes as libraryHashes,
  bundleHashes as libraryBundleHashes,
  subscribe as subscribeDrift,
  unsubscribe as unsubscribeDrift,
} from "../../components/context/drift-store";

const ui = useUiStore();
const commandIndex = useCommandIndex();
const recent = useRecentStore();
const stale = useStaleStore();
const system = useSystemStore();
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

function onServerRestarted(): void {
  stale.markStale();
}

/** How often to ping for restart-detection while the tab is visible.
 *  30s is a balance — fast enough that a user staring at the page
 *  notices the banner soon after restart, slow enough to be invisible
 *  in DevTools/network panels. */
const STALE_POLL_MS = 30_000;
let stalePollHandle: ReturnType<typeof setInterval> | null = null;

function pingForRestart(): void {
  if (stale.isStale) return;  // already flagged, no point re-polling
  void api.database.config().catch(() => undefined);
}

function startStalePoll(): void {
  if (stalePollHandle !== null) return;
  stalePollHandle = setInterval(pingForRestart, STALE_POLL_MS);
}

function stopStalePoll(): void {
  if (stalePollHandle === null) return;
  clearInterval(stalePollHandle);
  stalePollHandle = null;
}

/** Pause polling when tab hidden, resume on focus. Also fire one
 *  immediate ping on focus so we don't have to wait the full
 *  interval after the user returns. */
function onVisibilityChange(): void {
  if (document.visibilityState === "visible") {
    pingForRestart();
    startStalePoll();
  } else {
    stopStalePoll();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("wp:server-restarted", onServerRestarted);
  document.addEventListener("visibilitychange", onVisibilityChange);
  // Kick off the heartbeat. visibilitychange controls pause/resume.
  if (document.visibilityState === "visible") startStalePoll();
  // One-shot detection of ComfyUI Manager's reboot endpoint so banners
  // know whether to surface a "Restart ComfyUI" button alongside their
  // existing reload/cancel actions.
  void system.detectRestartCapability();
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
    cascadeStore.rebuildFromCatalogs(
      moduleStore.catalog, bundleStore.catalog, categoryStore.items,
    );
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
  // After the catalog refetch resolves, rebuild the cascade reverse-dep
  // index so a wildcard delete (etc.) immediately routes through the cascade
  // impact dialog. `rebuildFromCatalogs` is a pure read+build — safe to call
  // from a watch handler. This self-heals the index on ANY external write
  // (graph-side ContextWidget, SPA edits, the starter-set tutorial, external
  // tools), not just cascade-applies.
  watch(
    () => hashesFingerprint(libraryHashes.value),
    (next, prev) => {
      if (prev === undefined || prev === "" || next === prev) return;
      moduleStore.fetchCatalog()
        .then(() => cascadeStore.rebuildFromCatalogs(
          moduleStore.catalog, bundleStore.catalog, categoryStore.items,
        ))
        .catch(() => undefined);
    },
  );
  watch(
    () => hashesFingerprint(libraryBundleHashes.value),
    (next, prev) => {
      if (prev === undefined || prev === "" || next === prev) return;
      bundleStore.fetchCatalog()
        .then(() => cascadeStore.rebuildFromCatalogs(
          moduleStore.catalog, bundleStore.catalog, categoryStore.items,
        ))
        .catch(() => undefined);
    },
  );
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("wp:server-restarted", onServerRestarted);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  stopStalePoll();
  unsubscribeDrift();
});
</script>

<template>
  <div class="wp-app">
    <a href="#wp-main" class="wp-skip-link">Skip to main content</a>
    <StaleBanner />
    <AppTopbar />
    <div class="wp-body" :data-collapsed="ui.sidebarCollapsed || undefined">
      <AppSidebar />
      <main id="wp-main" class="wp-content" tabindex="-1">
        <ErrorBoundary>
          <RouterView v-slot="{ Component, route }">
            <Transition name="route-fade" mode="out-in">
              <!-- Key by `route.meta.layoutKey` when set so a view that backs
                   several param routes (e.g. Docs.vue across /docs/:page) stays
                   mounted across those navigations — its sub-nav keeps scroll
                   position. Falls back to route.path for every other view. -->
              <component
                :is="Component"
                :key="typeof route.meta.layoutKey === 'string' ? route.meta.layoutKey : route.path"
              />
            </Transition>
          </RouterView>
        </ErrorBoundary>
      </main>
    </div>
    <ToastHost />
    <TweaksPanel />
    <CommandPalette v-model:open="paletteOpen" :items="commandIndex" :recent-ids="recent.recentIds" />
    <ShortcutsHelp v-model:open="shortcutsOpen" />
  </div>
</template>

<!--
  Route-fade transition classes — UNSCOPED on purpose. Vue Transition
  injects `.route-fade-*` classes onto the routed component's root
  element, which carries its OWN scope attr (not AppLayout's). Scoped
  CSS here would never match. Prefix `route-fade-` is unique enough to
  not collide with anything else in the global namespace.
-->
<style>
.route-fade-enter-active,
.route-fade-leave-active {
  transition: transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
              opacity 160ms ease;
}
.route-fade-enter-from { opacity: 0; transform: translateY(6px); }
.route-fade-leave-to { opacity: 0; transform: translateY(-4px); }
.route-fade-leave-active { transition-duration: 100ms; }

@media (prefers-reduced-motion: reduce) {
  .route-fade-enter-active,
  .route-fade-leave-active { transition: none; }
  .route-fade-enter-from,
  .route-fade-leave-to { transform: none; }
}
</style>
