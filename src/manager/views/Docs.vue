<script setup lang="ts">
import { computed, ref, shallowRef, watch, type Component } from "vue";
import { RouterLink } from "vue-router";
import { DOC_GROUPS, pagesByGroup, findPage, searchPages, toneVar, type DocGroupId } from "../docs/registry";

const props = defineProps<{ page?: string }>();

const query = ref("");
const activeMeta = computed(() => findPage(props.page) ?? findPage("introduction"));
const visibleIds = computed(() => new Set(searchPages(query.value).map((p) => p.id)));

function groupPages(g: DocGroupId) {
  return pagesByGroup(g).filter((p) => visibleIds.value.has(p.id));
}

// Resolved synchronous component. Call the raw loader (stored on the registry
// entry as `.loader`) so flushPromises() fully settles it in tests without
// needing Suspense. In production the Promise resolves on first render with no
// visible difference (the shallowRef update triggers Vue's reactivity).
const resolvedComponent = shallowRef<Component | null>(null);
watch(
  activeMeta,
  async (meta) => {
    if (!meta) { resolvedComponent.value = null; return; }
    const mod = await meta.loader();
    resolvedComponent.value = mod.default;
  },
  { immediate: true },
);
</script>

<template>
  <div class="wp-doc">
    <aside class="wp-doc__nav">
      <div class="wp-doc__search">
        <i class="pi pi-search" aria-hidden="true" />
        <input
          v-model="query"
          data-test="doc-search"
          type="text"
          placeholder="Search docs…"
          aria-label="Search documentation"
        />
      </div>
      <template v-for="g in DOC_GROUPS" :key="g.id">
        <div v-if="groupPages(g.id).length" class="wp-doc__grp">{{ g.label }}</div>
        <RouterLink
          v-for="p in groupPages(g.id)"
          :key="p.id"
          :to="`/docs/${p.id}`"
          class="wp-doc__link"
          :class="{ 'is-active': p.id === activeMeta?.id }"
          :style="{ '--doc-tone': toneVar(p.tone) }"
        >
          <i
            :class="[p.icon, 'wp-doc__link-icon', { 'wp-doc__link-icon--toned': p.tone !== 'neutral' }]"
            aria-hidden="true"
          />
          {{ p.title }}
        </RouterLink>
      </template>
    </aside>
    <main class="wp-doc__content">
      <component :is="resolvedComponent" v-if="resolvedComponent" />
    </main>
  </div>
</template>

<style scoped>
.wp-doc {
  display: grid;
  grid-template-columns: 236px 1fr;
  min-height: 0;
  height: 100%;
}
.wp-doc__nav {
  border-right: 1px solid var(--wp-border);
  background: var(--wp-bg);
  overflow-y: auto;
  padding: 14px 10px 28px;
}
.wp-doc__search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 9px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: 7px;
  color: var(--wp-text-dim);
  margin-bottom: 14px;
}
.wp-doc__search input {
  flex: 1;
  background: transparent;
  border: 0;
  outline: none;
  color: var(--wp-text);
  font: inherit;
  font-size: 12px;
}
.wp-doc__grp {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--wp-text-dim);
  padding: 12px 8px 5px;
}
.wp-doc__link {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 5px 9px;
  border-radius: 6px;
  color: var(--wp-text-muted);
  text-decoration: none;
  font-size: 12.5px;
}
.wp-doc__link:hover {
  background: var(--wp-bg-3);
  color: var(--wp-text);
}
.wp-doc__link.is-active {
  background: color-mix(in oklab, var(--wp-accent-500) 16%, transparent);
  color: var(--wp-text);
  font-weight: 500;
}
.wp-doc__link-icon {
  width: 15px;
  font-size: 12.5px;
  color: var(--wp-text-dim);
  text-align: center;
  flex: 0 0 15px;
}
.wp-doc__link-icon--toned { color: var(--doc-tone); }
.wp-doc__link.is-active .wp-doc__link-icon { color: inherit; }
.wp-doc__content {
  overflow-y: auto;
  padding: 26px 34px 60px;
}
</style>
