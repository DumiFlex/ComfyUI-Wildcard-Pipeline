<script setup lang="ts">
import { RouterView } from "vue-router";
import AppTopbar from "./AppTopbar.vue";
import AppSidebar from "./AppSidebar.vue";
import { useUiStore } from "../stores/uiStore";

const ui = useUiStore();
</script>

<template>
  <div class="flex flex-col min-h-screen">
    <AppTopbar />
    <div class="flex flex-1 min-h-0">
      <AppSidebar v-show="!ui.sidebarCollapsed" />
      <main class="flex-1 overflow-auto bg-wp-bg">
        <RouterView />
      </main>
    </div>
  </div>
</template>
