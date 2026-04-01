<script setup lang="ts">
import { computed } from 'vue'
import Card from 'primevue/card'
import Tag from 'primevue/tag'
import Button from 'primevue/button'

interface Stat {
  label: string
  value: number | string
}

const props = defineProps<{
  name: string
  category?: string
  tags?: string[]
  stats: Stat[]
  icon?: string
}>()

const emit = defineEmits<{
  edit: []
  delete: []
}>()

const visibleTags = computed(() => props.tags?.slice(0, 3) ?? [])
const extraTagCount = computed(() => Math.max(0, (props.tags?.length ?? 0) - 3))
</script>

<template>
  <div class="resource-card">
    <Card class="resource-card__inner">
      <template #header>
        <div class="resource-card__header">
          <div class="resource-card__title-row">
            <i v-if="icon" :class="['resource-card__icon', icon]" />
            <span class="resource-card__name">{{ name }}</span>
          </div>
          <Tag v-if="category" :value="category" severity="secondary" class="resource-card__category" />
        </div>
      </template>

      <template #content>
        <div class="resource-card__body">
          <div v-if="visibleTags.length" class="resource-card__tags">
            <Tag
              v-for="tag in visibleTags"
              :key="tag"
              :value="tag"
              severity="secondary"
              class="resource-card__tag"
            />
            <span v-if="extraTagCount > 0" class="resource-card__tag-overflow">
              +{{ extraTagCount }} more
            </span>
          </div>

          <div class="resource-card__stats">
            <div v-for="stat in stats" :key="stat.label" class="resource-card__stat">
              <span class="resource-card__stat-label">{{ stat.label }}</span>
              <span class="resource-card__stat-value">{{ stat.value }}</span>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="resource-card__actions card-actions">
          <Button
            icon="pi pi-pencil"
            text
            size="small"
            aria-label="Edit"
            @click="emit('edit')"
          />
          <Button
            icon="pi pi-trash"
            severity="danger"
            text
            size="small"
            aria-label="Delete"
            @click="emit('delete')"
          />
        </div>
      </template>
    </Card>
  </div>
</template>

<style scoped>
.resource-card {
  position: relative;
}

.resource-card__inner {
  height: 100%;
  transition: box-shadow 0.2s ease, transform 0.2s ease;
  border: 1px solid var(--p-surface-200);
  background: var(--p-surface-0);
}

.resource-card:hover .resource-card__inner {
  box-shadow: 0 4px 16px var(--p-surface-400);
  transform: translateY(-1px);
}

.resource-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 1rem 1rem 0;
}

.resource-card__title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.resource-card__icon {
  color: var(--p-primary-color);
  font-size: 1rem;
  flex-shrink: 0;
}

.resource-card__name {
  font-weight: 600;
  font-size: 0.9375rem;
  color: var(--p-text-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.resource-card__category {
  font-size: 0.75rem;
  flex-shrink: 0;
}

.resource-card__body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.resource-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  align-items: center;
}

.resource-card__tag {
  font-size: 0.6875rem;
}

.resource-card__tag-overflow {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.resource-card__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.resource-card__stat {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.resource-card__stat-label {
  font-size: 0.6875rem;
  color: var(--p-text-muted-color);
  line-height: 1;
}

.resource-card__stat-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.card-actions {
  display: flex;
  gap: 0.25rem;
  justify-content: flex-end;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.resource-card:hover .card-actions {
  opacity: 1;
}

@media (hover: none) {
  .card-actions {
    opacity: 1;
  }
}
</style>
