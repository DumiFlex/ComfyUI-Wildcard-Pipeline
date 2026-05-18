<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { RouterView } from "vue-router";
import AppTopbar from "./AppTopbar.vue";
import AppSidebar from "./AppSidebar.vue";
import ToastHost from "../components/ui/ToastHost.vue";
import TweaksPanel from "../components/TweaksPanel.vue";
import CommandPalette from "../components/CommandPalette.vue";
import { useUiStore } from "../stores/uiStore";
import { useCommandIndex } from "../composables/useCommandIndex";
import { useRecentStore } from "../stores/recentStore";
import { useModuleStore } from "../stores/moduleStore";
import { useBundleStore } from "../stores/bundleStore";
import { useCategoryStore } from "../stores/categoryStore";

const ui = useUiStore();
const commandIndex = useCommandIndex();
const recent = useRecentStore();
const moduleStore = useModuleStore();
const bundleStore = useBundleStore();
const categoryStore = useCategoryStore();

const paletteOpen = ref(false);

function onKeydown(e: KeyboardEvent) {
  if (e.key !== "k" && e.key !== "K") return;
  if (!(e.metaKey || e.ctrlKey)) return;
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea") return;
  if (target?.isContentEditable) return;
  e.preventDefault();
  paletteOpen.value = !paletteOpen.value;
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  // Eager-fetch the three library stores so sidebar count badges,
  // Cmd+K palette index, and Recents section have real data on cold
  // load. Dashboard fetches via api.* directly and does not touch
  // these stores; list views fetch lazily on mount but only after the
  // user navigates to them. AppLayout mounts once for the entire SPA
  // lifetime, so this is a one-time cost per app load.
  // Fire-and-forget: errors silently swallowed — the lazy list-view
  // fetches still run on actual usage if a fetch fails here.
  void moduleStore.fetchCatalog().catch(() => undefined);
  void bundleStore.fetchCatalog().catch(() => undefined);
  void categoryStore.fetchAll().catch(() => undefined);
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
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
  </div>
</template>
