<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Menu from 'primevue/menu'
import Toolbar from 'primevue/toolbar'

const router = useRouter()
const route = useRoute()

const menuItems = ref([
  {
    label: 'Wildcards',
    icon: 'pi pi-fw pi-tags',
    command: () => router.push('/wildcards')
  },
  {
    label: 'Constraints',
    icon: 'pi pi-fw pi-filter',
    command: () => router.push('/constraints')
  },
  {
    label: 'Pipelines',
    icon: 'pi pi-fw pi-share-alt',
    command: () => router.push('/pipelines')
  }
])
</script>

<template>
  <div class="layout-wrapper">
    <aside class="sidebar">
      <div class="logo">WP-MANAGER</div>
      <Menu :model="menuItems" class="nav-menu" />
    </aside>
    <main class="content-area">
      <Toolbar class="topbar">
        <template #start>
          <h2 class="page-title">{{ route.path.replace('/', '').toUpperCase() }}</h2>
        </template>
        <template #end>
          <div class="status-indicator">
            <span class="status-dot"></span>
            SYS_ONLINE
          </div>
        </template>
      </Toolbar>
      <div class="page-content">
        <router-view />
      </div>
    </main>
  </div>
</template>

<style scoped>
.layout-wrapper {
  display: flex;
  min-height: 100vh;
  background-color: var(--bg-base);
}

.sidebar {
  width: 250px;
  background-color: var(--bg-panel);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
}

.logo {
  padding: var(--space-6) var(--space-4);
  font-size: var(--text-xl);
  font-weight: 800;
  color: var(--accent-primary);
  border-bottom: 1px solid var(--border-color);
  letter-spacing: 0.1em;
  text-shadow: 0 0 8px rgba(0, 229, 89, 0.3);
}

.nav-menu {
  border: none;
  background: transparent;
  width: 100%;
}

:deep(.p-menu) {
  border: none !important;
}

.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.topbar {
  background-color: var(--bg-panel);
  border: none;
  border-bottom: 1px solid var(--border-color);
  border-radius: 0;
  padding: var(--space-4) var(--space-6);
}

.page-title {
  margin: 0;
  font-size: var(--text-lg);
  color: var(--text-primary);
  letter-spacing: 0.1em;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--accent-primary);
}

.status-dot {
  width: 8px;
  height: 8px;
  background-color: var(--accent-primary);
  border-radius: 50%;
  box-shadow: 0 0 6px var(--accent-primary);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { opacity: 1; }
  50% { opacity: 0.4; }
  100% { opacity: 1; }
}

.page-content {
  flex: 1;
  padding: var(--space-6);
  overflow-y: auto;
}
</style>
