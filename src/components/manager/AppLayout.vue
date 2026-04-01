<script setup lang="ts">
import { useRoute } from 'vue-router'
import { computed } from 'vue'
import Toolbar from 'primevue/toolbar'
import Toast from 'primevue/toast'

const route = useRoute()

const menuItems = [
  { label: 'Dashboard', icon: 'pi pi-fw pi-home', path: '/' },
  { label: 'Wildcards', icon: 'pi pi-fw pi-tags', path: '/wildcards' },
  { label: 'Constraints', icon: 'pi pi-fw pi-filter', path: '/constraints' },
  { label: 'Pipelines', icon: 'pi pi-fw pi-share-alt', path: '/pipelines' }
]

const pageTitle = computed(() => {
  if (route.name && typeof route.name === 'string') {
    const name = route.name
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
  }
  return route.path === '/' ? 'Dashboard' : route.path.replace('/', '')
})
</script>

<template>
  <div class="layout-wrapper app-dark">
    <Toast />
    <aside class="sidebar">
      <div class="logo">Wildcard Pipeline</div>
      <nav class="nav-menu">
        <router-link
          v-for="item in menuItems"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ 'is-active': route.path === item.path }"
        >
          <i :class="item.icon"></i>
          <span>{{ item.label }}</span>
        </router-link>
      </nav>
    </aside>
    <main class="content-area">
      <Toolbar class="topbar">
        <template #start>
          <h2 class="page-title">{{ pageTitle }}</h2>
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
  background-color: var(--p-surface-100);
}

.sidebar {
  width: 250px;
  background-color: var(--p-surface-50);
  border-right: 1px solid var(--p-surface-200);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.logo {
  padding: 1.5rem 1rem;
  font-size: 1.0625rem;
  font-weight: 700;
  color: var(--p-primary-color);
  border-bottom: 1px solid var(--p-surface-200);
  text-align: center;
}

.nav-menu {
  display: flex;
  flex-direction: column;
  padding: 1rem 0;
  gap: 0.25rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  color: var(--p-text-muted-color);
  font-size: 1rem;
  text-decoration: none;
  border-left: 3px solid transparent;
  transition: all 0.2s ease;
}

.nav-item:hover {
  background-color: var(--p-surface-100);
  color: var(--p-text-color);
  border-left-color: var(--p-surface-300);
}

.nav-item.is-active {
  background-color: var(--p-highlight-background);
  color: var(--p-primary-color);
  border-left-color: var(--p-primary-color);
}

.nav-item i {
  font-size: 1.125rem;
}

.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.topbar {
  background-color: var(--p-surface-0);
  border: none;
  border-bottom: 1px solid var(--p-surface-200);
  border-radius: 0;
  padding: 1rem 1.5rem;
  margin: 0;
}

.page-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.page-content {
  flex: 1;
  padding: 1.5rem;
  overflow-y: auto;
}
</style>
