<script setup lang="ts">
import { RouterView } from "vue-router";
import AppTopbar from "./AppTopbar.vue";
import AppSidebar from "./AppSidebar.vue";
import ToastHost from "../components/ui/ToastHost.vue";
import TweaksPanel from "../components/TweaksPanel.vue";
import { useUiStore } from "../stores/uiStore";

const ui = useUiStore();
</script>

<template>
  <div class="wp-app">
    <AppTopbar />
    <div class="wp-body" :data-collapsed="ui.sidebarCollapsed || undefined">
      <AppSidebar />
      <main class="wp-content">
        <RouterView v-slot="{ Component, route }">
          <Transition name="route-fade" mode="out-in">
            <component :is="Component" :key="route.path" />
          </Transition>
        </RouterView>
      </main>
    </div>
    <ToastHost />
    <TweaksPanel />
  </div>
</template>
