<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useWildcardStore } from '../stores/wildcards'
import { useConstraintStore } from '../stores/constraints'
import { usePipelineStore } from '../stores/pipelines'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import ProgressSpinner from 'primevue/progressspinner'
import Message from 'primevue/message'

const router = useRouter()
const wildcardStore = useWildcardStore()
const constraintStore = useConstraintStore()
const pipelineStore = usePipelineStore()

onMounted(async () => {
  await Promise.all([
    wildcardStore.fetchAll(),
    wildcardStore.fetchCategories(),
    wildcardStore.fetchTags(),
    constraintStore.fetchAll(),
    constraintStore.fetchCategories(),
    constraintStore.fetchTags(),
    pipelineStore.fetchAll(),
    pipelineStore.fetchCategories(),
    pipelineStore.fetchTags()
  ])
})

const isLoading = computed(() => {
  return wildcardStore.loading || constraintStore.loading || pipelineStore.loading
})

const hasError = computed(() => {
  return wildcardStore.error !== null || constraintStore.error !== null || pipelineStore.error !== null
})

const totalWildcards = computed(() => wildcardStore.totalCount)
const totalConstraints = computed(() => constraintStore.totalCount)
const totalPipelines = computed(() => pipelineStore.totalCount)
const totalOptions = computed(() => {
  return wildcardStore.items.reduce((sum, w) => sum + (w.options?.length || 0), 0)
})

const isAllEmpty = computed(() => {
  return totalWildcards.value === 0 && totalConstraints.value === 0 && totalPipelines.value === 0
})

// ── Category Breakdown ──────────────────────────────────────────────────────

interface CategoryBar {
  label: string
  count: number
  widthPct: number
}

function buildCategoryBars(counts: Record<string, number>): CategoryBar[] {
  const entries = Object.entries(counts)
  if (entries.length === 0) return []
  const maxCount = Math.max(...entries.map(([, v]) => v))
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => ({
      label: key === '' ? 'uncategorized' : key,
      count,
      widthPct: maxCount > 0 ? Math.round((count / maxCount) * 100) : 0,
    }))
}

const wildcardCategoryBars = computed(() => buildCategoryBars(wildcardStore.categoryCounts))
const constraintCategoryBars = computed(() => buildCategoryBars(constraintStore.categoryCounts))
const pipelineCategoryBars = computed(() => buildCategoryBars(pipelineStore.categoryCounts))

// ── Top Tags ────────────────────────────────────────────────────────────────

const topTags = computed((): string[] => {
  const counts = new Map<string, number>()
  const addTags = (tags: string[] | undefined) => {
    if (!tags) return
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  for (const item of wildcardStore.items) addTags(item.tags)
  for (const item of constraintStore.items) addTags(item.tags)
  for (const item of pipelineStore.items) addTags(item.tags)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([tag]) => tag)
})

// ── Actions ─────────────────────────────────────────────────────────────────

function onTagClick(tag: string) {
  wildcardStore.selectedTags = [tag]
  router.push('/wildcards')
}

async function retryAll() {
  await Promise.all([
    wildcardStore.fetchAll(), wildcardStore.fetchCategories(), wildcardStore.fetchTags(),
    constraintStore.fetchAll(), constraintStore.fetchCategories(), constraintStore.fetchTags(),
    pipelineStore.fetchAll(), pipelineStore.fetchCategories(), pipelineStore.fetchTags(),
  ])
}

const statCards = computed(() => [
  { label: 'Wildcards', value: totalWildcards.value, icon: 'pi pi-tags', route: '/wildcards' },
  { label: 'Constraints', value: totalConstraints.value, icon: 'pi pi-filter', route: '/constraints' },
  { label: 'Pipelines', value: totalPipelines.value, icon: 'pi pi-share-alt', route: '/pipelines' },
  { label: 'Total Options', value: totalOptions.value, icon: 'pi pi-list', route: null },
])

const quickActions = [
  { label: 'New Wildcard', icon: 'pi pi-tags', route: '/wildcards', query: { create: 'true' } },
  { label: 'New Constraint', icon: 'pi pi-filter', route: '/constraints', query: { create: 'true' } },
  { label: 'New Pipeline', icon: 'pi pi-share-alt', route: '/pipelines', query: { create: 'true' } },
]
</script>

<template>
  <div class="dashboard">

    <!-- Loading -->
    <div v-if="isLoading" class="center-state">
      <ProgressSpinner style="width: 2.5rem; height: 2.5rem" strokeWidth="4" />
      <p style="color: var(--p-text-muted-color)">Loading dashboard…</p>
    </div>

    <!-- Error Banner -->
    <div v-else-if="hasError" class="error-section">
      <Message v-if="wildcardStore.error" severity="error" :closable="false">
        <strong>Wildcards:</strong> {{ wildcardStore.error }}
      </Message>
      <Message v-if="constraintStore.error" severity="error" :closable="false">
        <strong>Constraints:</strong> {{ constraintStore.error }}
      </Message>
      <Message v-if="pipelineStore.error" severity="error" :closable="false">
        <strong>Pipelines:</strong> {{ pipelineStore.error }}
      </Message>
      <Button icon="pi pi-refresh" label="Retry" @click="retryAll" class="retry-btn" />
    </div>

    <!-- Empty state -->
    <div v-else-if="isAllEmpty" class="center-state">
      <i class="pi pi-box" style="font-size: 3rem; color: var(--p-text-muted-color)" />
      <h2 style="color: var(--p-text-color); margin: 0">No Resources Found</h2>
      <p style="color: var(--p-text-muted-color); margin: 0">Create your first wildcard, constraint, or pipeline to get started.</p>
      <div class="quick-actions">
        <Button
          v-for="action in quickActions"
          :key="action.label"
          :label="action.label"
          :icon="action.icon"
          outlined
          @click="router.push({ path: action.route, query: action.query })"
        />
      </div>
    </div>

    <!-- Dashboard content -->
    <div v-else class="dashboard-content">

      <!-- ── Stat cards ── -->
      <div class="stat-grid">
        <Card
          v-for="stat in statCards"
          :key="stat.label"
          class="stat-card"
          :class="{ 'stat-card--link': !!stat.route }"
          @click="stat.route && router.push(stat.route)"
        >
          <template #content>
            <div class="stat-card__inner">
              <div class="stat-card__icon-wrap">
                <i :class="[stat.icon, 'stat-card__icon']" />
              </div>
              <div class="stat-card__text">
                <span class="stat-card__value">{{ stat.value }}</span>
                <span class="stat-card__label">{{ stat.label }}</span>
              </div>
            </div>
          </template>
        </Card>
      </div>

      <!-- ── Quick Actions ── -->
      <section class="dashboard-section">
        <h2 class="section-heading">
          <i class="pi pi-bolt" /> Quick Actions
        </h2>
        <div class="quick-actions">
          <Button
            v-for="action in quickActions"
            :key="action.label"
            :label="action.label"
            :icon="action.icon"
            outlined
            @click="router.push({ path: action.route, query: action.query })"
          />
        </div>
      </section>

      <!-- ── Category Breakdown ── -->
      <section class="dashboard-section">
        <h2 class="section-heading">
          <i class="pi pi-list" /> Category Breakdown
        </h2>
        <div class="breakdown-grid">
          <!-- Wildcards -->
          <Card class="breakdown-card">
            <template #header>
              <div class="breakdown-card__header">
                <i class="pi pi-tags" />
                <span>Wildcards</span>
              </div>
            </template>
            <template #content>
              <div v-if="wildcardCategoryBars.length === 0" class="breakdown-empty">No items</div>
              <div v-else class="bar-list">
                <div v-for="bar in wildcardCategoryBars" :key="bar.label" class="bar-row">
                  <span class="bar-label">{{ bar.label }}</span>
                  <div class="bar-track">
                    <div class="bar-fill" :style="{ width: bar.widthPct + '%' }" />
                  </div>
                  <span class="bar-count">{{ bar.count }}</span>
                </div>
              </div>
            </template>
          </Card>

          <!-- Constraints -->
          <Card class="breakdown-card">
            <template #header>
              <div class="breakdown-card__header">
                <i class="pi pi-filter" />
                <span>Constraints</span>
              </div>
            </template>
            <template #content>
              <div v-if="constraintCategoryBars.length === 0" class="breakdown-empty">No items</div>
              <div v-else class="bar-list">
                <div v-for="bar in constraintCategoryBars" :key="bar.label" class="bar-row">
                  <span class="bar-label">{{ bar.label }}</span>
                  <div class="bar-track">
                    <div class="bar-fill" :style="{ width: bar.widthPct + '%' }" />
                  </div>
                  <span class="bar-count">{{ bar.count }}</span>
                </div>
              </div>
            </template>
          </Card>

          <!-- Pipelines -->
          <Card class="breakdown-card">
            <template #header>
              <div class="breakdown-card__header">
                <i class="pi pi-share-alt" />
                <span>Pipelines</span>
              </div>
            </template>
            <template #content>
              <div v-if="pipelineCategoryBars.length === 0" class="breakdown-empty">No items</div>
              <div v-else class="bar-list">
                <div v-for="bar in pipelineCategoryBars" :key="bar.label" class="bar-row">
                  <span class="bar-label">{{ bar.label }}</span>
                  <div class="bar-track">
                    <div class="bar-fill" :style="{ width: bar.widthPct + '%' }" />
                  </div>
                  <span class="bar-count">{{ bar.count }}</span>
                </div>
              </div>
            </template>
          </Card>
        </div>
      </section>

      <!-- ── Top Tags ── -->
      <section v-if="topTags.length" class="dashboard-section">
        <h2 class="section-heading">
          <i class="pi pi-hashtag" /> Top Tags
        </h2>
        <div class="tags-cloud">
          <Tag
            v-for="tag in topTags"
            :key="tag"
            :value="tag"
            severity="secondary"
            class="tag-pill"
            role="button"
            tabindex="0"
            @click="onTagClick(tag)"
            @keydown.enter="onTagClick(tag)"
            @keydown.space.prevent="onTagClick(tag)"
          />
        </div>
      </section>

      <!-- ── Navigate ── -->
      <section class="dashboard-section">
        <h2 class="section-heading">
          <i class="pi pi-compass" /> Manage Resources
        </h2>
        <div class="nav-cards">
          <Card class="nav-card" @click="router.push('/wildcards')">
            <template #content>
              <div class="nav-card__inner">
                <i class="pi pi-tags nav-card__icon" />
                <div>
                  <div class="nav-card__title">Wildcards</div>
                  <div class="nav-card__desc">Create and edit weighted option lists</div>
                </div>
                <i class="pi pi-chevron-right nav-card__arrow" />
              </div>
            </template>
          </Card>
          <Card class="nav-card" @click="router.push('/constraints')">
            <template #content>
              <div class="nav-card__inner">
                <i class="pi pi-filter nav-card__icon" />
                <div>
                  <div class="nav-card__title">Constraints</div>
                  <div class="nav-card__desc">Define rules for weight modification</div>
                </div>
                <i class="pi pi-chevron-right nav-card__arrow" />
              </div>
            </template>
          </Card>
          <Card class="nav-card" @click="router.push('/pipelines')">
            <template #content>
              <div class="nav-card__inner">
                <i class="pi pi-share-alt nav-card__icon" />
                <div>
                  <div class="nav-card__title">Pipelines</div>
                  <div class="nav-card__desc">Sequence modules into reusable chains</div>
                </div>
                <i class="pi pi-chevron-right nav-card__arrow" />
              </div>
            </template>
          </Card>
        </div>
      </section>

    </div>
  </div>
</template>

<style scoped>
.dashboard {
  padding-bottom: 2rem;
}

/* ── Center states ── */
.center-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 4rem 2rem;
  text-align: center;
}

/* ── Error section ── */
.error-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.retry-btn {
  align-self: flex-start;
}
/* ── Dashboard content ── */
.dashboard-content {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

/* ── Stat grid ── */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
}

.stat-card {
  transition: box-shadow 0.2s ease, transform 0.15s ease;
}

.stat-card--link {
  cursor: pointer;
}

.stat-card--link:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  transform: translateY(-1px);
}

.stat-card__inner {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.stat-card__icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: var(--p-highlight-background);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-card__icon {
  font-size: 1.25rem;
  color: var(--p-primary-color);
}

.stat-card__text {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.stat-card__value {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--p-text-color);
  line-height: 1;
}

.stat-card__label {
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
}

/* ── Section ── */
.dashboard-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.section-heading {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--p-text-color);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.section-heading i {
  color: var(--p-primary-color);
  font-size: 0.9rem;
}

/* ── Quick actions ── */
.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

/* ── Breakdown grid ── */
.breakdown-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1rem;
}

.breakdown-card__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.875rem 1rem 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.breakdown-card__header i {
  color: var(--p-primary-color);
}

.breakdown-empty {
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
  font-style: italic;
}

.bar-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.bar-row {
  display: grid;
  grid-template-columns: 7rem 1fr 2rem;
  align-items: center;
  gap: 0.5rem;
}

.bar-label {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-track {
  height: 6px;
  background: var(--p-surface-200);
  border-radius: 3px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: var(--p-primary-color);
  border-radius: 3px;
  transition: width 0.4s ease;
  min-width: 2px;
}

.bar-count {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  text-align: right;
}

/* ── Top Tags ── */
.tags-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.tag-pill {
  cursor: pointer;
  transition: opacity 0.15s;
  user-select: none;
}

.tag-pill:hover {
  opacity: 0.75;
}

.tag-pill:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 2px;
  border-radius: 4px;
}

/* ── Navigate cards ── */
.nav-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1rem;
}

.nav-card {
  cursor: pointer;
  transition: box-shadow 0.2s ease, transform 0.15s ease;
}

.nav-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  transform: translateY(-1px);
}

.nav-card__inner {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.nav-card__icon {
  font-size: 1.5rem;
  color: var(--p-primary-color);
  flex-shrink: 0;
}

.nav-card__title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.nav-card__desc {
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
  margin-top: 0.125rem;
}

.nav-card__arrow {
  margin-left: auto;
  color: var(--p-text-muted-color);
  font-size: 0.875rem;
}
</style>
