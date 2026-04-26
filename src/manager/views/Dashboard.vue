<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import { useModuleStore } from "../stores/moduleStore";
import { useCategoryStore } from "../stores/categoryStore";
import RelativeDate from "../components/RelativeDate.vue";

const router = useRouter();
const moduleStore = useModuleStore();
const categoryStore = useCategoryStore();
const faviconUrl = `${import.meta.env.BASE_URL}images/favicon.svg`;

onMounted(async () => {
  moduleStore.filter.type = undefined;
  await Promise.all([moduleStore.fetchAll(), categoryStore.fetchAll()]);
});

const recent = computed(() => [...moduleStore.items].slice(0, 5));
</script>

<template>
  <div class="p-6 text-wp-text">
    <section class="hero-card mb-6">
      <img :src="faviconUrl" alt="" class="hero-card__logo" />
      <div class="flex-1">
        <h1 class="text-2xl font-semibold m-0">Welcome to Wildcard Pipeline</h1>
        <p class="text-sm m-0 mt-1 opacity-90">
          Manage modules — wildcards, fixed values — that drop into ComfyUI prompts as snapshots.
        </p>
      </div>
    </section>

    <div class="grid grid-cols-4 gap-4 mb-6">
      <div class="stat-card">
        <div class="stat-card__label">Wildcards</div>
        <div class="stat-card__value">{{ moduleStore.wildcards.length }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Fixed values</div>
        <div class="stat-card__value">{{ moduleStore.fixedValues.length }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Categories</div>
        <div class="stat-card__value">{{ categoryStore.items.length }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__label">Total modules</div>
        <div class="stat-card__value">{{ moduleStore.items.length }}</div>
      </div>
    </div>

    <h2 class="text-sm uppercase tracking-wider text-wp-text2 mb-2">Recent edits</h2>
    <div v-if="recent.length" class="bg-wp-bg2 border border-wp-border rounded">
      <div
        v-for="m in recent" :key="m.id"
        class="flex items-center justify-between px-4 py-2 border-b border-wp-border last:border-b-0 cursor-pointer hover:bg-wp-bg3"
        @click="router.push(m.type === 'wildcard' ? `/wildcards/${m.id}/edit` : `/fixed-values/${m.id}/edit`)"
      >
        <div class="flex items-center gap-3">
          <i :class="m.type === 'wildcard' ? 'pi pi-th-large text-wp-violet' : 'pi pi-tag text-wp-rose'" />
          <span class="font-medium">{{ m.name }}</span>
          <span class="text-xs text-wp-text3 font-mono">{{ m.id }}</span>
        </div>
        <RelativeDate :value="m.updated_at" />
      </div>
    </div>
    <p v-else class="text-sm text-wp-text2">No modules yet.</p>

    <div class="mt-6 flex gap-2 flex-wrap">
      <Button label="New wildcard" icon="pi pi-plus" severity="primary" @click="router.push('/wildcards/new')" />
      <Button label="New fixed values" icon="pi pi-plus" severity="primary" outlined @click="router.push('/fixed-values/new')" />
      <Button label="Open test runner" icon="pi pi-bolt" severity="secondary" outlined @click="router.push('/test')" />
    </div>
  </div>
</template>

<style scoped>
.hero-card {
  display: flex; gap: 20px; align-items: center;
  padding: 24px;
  background: var(--wp-brand-gradient);
  border-radius: var(--wp-radius);
  color: #fff;
}
.hero-card__logo {
  width: 64px;
  height: 64px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 50%;
  box-sizing: content-box;
  flex-shrink: 0;
}
.stat-card {
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  padding: 16px;
}
.stat-card__label {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--wp-text2);
}
.stat-card__value { font-size: 28px; font-weight: 600; margin-top: 4px; }
</style>
