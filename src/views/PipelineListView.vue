<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { usePipelineStore } from '../stores/pipelines'
import type { PipelineData } from '../api/client'
import { MODULE_TYPE_LABELS, type ModuleType } from '../types'
import { useToast } from 'primevue/usetoast'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Button from 'primevue/button'
import Select from 'primevue/select'
import PipelineWidget from '../components/pipeline/PipelineWidget.vue'
import ResourceCard from '../components/manager/ResourceCard.vue'

const store = usePipelineStore()
const toast = useToast()

onMounted(() => {
  store.fetchAll()
  store.fetchCategories()
  store.fetchTags()
})

const displayEditDialog = ref(false)
const displayDeleteDialog = ref(false)
const isNew = ref(false)

const searchQuery = ref('')

const currentPipeline = ref<PipelineData>({ name: '', version: 1, modules: [] })
const itemToDelete = ref<PipelineData | null>(null)

function getModuleSummary(pipeline: PipelineData): string {
  const counts: Record<string, number> = {}
  for (const mod of pipeline.modules) {
    counts[mod.type] = (counts[mod.type] || 0) + 1
  }
  return Object.entries(counts)
    .map(([t, c]) => `${c} ${MODULE_TYPE_LABELS[t as ModuleType] || t}`)
    .join(', ')
}

const filteredItems = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return store.filteredItems
  return store.filteredItems.filter(item =>
    item.name.toLowerCase().includes(q) ||
    item.tags?.some(t => t.toLowerCase().includes(q))
  )
})

function getStats(item: PipelineData) {
  return [
    { label: 'Modules', value: item.modules?.length ?? 0 },
    { label: 'Summary', value: getModuleSummary(item) || '—' },
  ]
}

const openNew = () => {
  currentPipeline.value = { name: '', version: 1, modules: [] }
  isNew.value = true
  displayEditDialog.value = true
}

const editPipeline = (data: PipelineData) => {
  currentPipeline.value = JSON.parse(JSON.stringify(data))
  isNew.value = false
  displayEditDialog.value = true
}

const confirmDelete = (item: PipelineData) => {
  itemToDelete.value = item
  displayDeleteDialog.value = true
}

const savePipeline = async () => {
  try {
    if (isNew.value) {
      await store.create(currentPipeline.value)
      toast.add({ severity: 'success', summary: 'Created', detail: `Pipeline ${currentPipeline.value.name} created`, life: 3000 })
    } else {
      await store.update(currentPipeline.value.id!, currentPipeline.value)
      toast.add({ severity: 'success', summary: 'Updated', detail: `Pipeline ${currentPipeline.value.name} updated`, life: 3000 })
    }
    displayEditDialog.value = false
  } catch (error: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: error.message || 'Operation failed', life: 5000 })
  }
}

const deletePipeline = async () => {
  if (itemToDelete.value && itemToDelete.value.id) {
    try {
      await store.remove(itemToDelete.value.id)
      toast.add({ severity: 'success', summary: 'Deleted', detail: `Pipeline ${itemToDelete.value.name} deleted`, life: 3000 })
      displayDeleteDialog.value = false
      itemToDelete.value = null
    } catch (error: any) {
      toast.add({ severity: 'error', summary: 'Error', detail: error.message || 'Operation failed', life: 5000 })
    }
  }
}
</script>

<template>
  <div class="view-container">
    <!-- Header bar -->
    <div class="header-bar">
      <Button label="New Pipeline" icon="pi pi-plus" @click="openNew" />
      <InputText v-model="searchQuery" placeholder="Search pipelines..." class="search-input" />
      <Select
        v-model="store.selectedCategory"
        :options="store.categories"
        placeholder="All Categories"
        showClear
        class="category-filter"
      />
      <Button icon="pi pi-refresh" text @click="() => { store.fetchAll(); store.fetchCategories(); store.fetchTags() }" :loading="store.loading" />
    </div>

    <!-- Loading state -->
    <div v-if="store.loading && filteredItems.length === 0" class="loading-state">
      <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem; color: var(--p-text-muted-color)" />
      <span style="color: var(--p-text-muted-color)">Loading pipelines…</span>
    </div>

    <!-- Card grid -->
    <div v-else-if="filteredItems.length" class="card-grid">
      <ResourceCard
        v-for="item in filteredItems"
        :key="item.id"
        :name="item.name"
        :category="item.category"
        :tags="item.tags"
        :stats="getStats(item)"
        icon="pi pi-share-alt"
        @edit="editPipeline(item)"
        @delete="confirmDelete(item)"
      />
    </div>

    <!-- Empty state -->
    <div v-else class="empty-state">
      <i class="pi pi-inbox" style="font-size: 2.5rem; color: var(--p-text-muted-color)" />
      <p style="color: var(--p-text-muted-color); margin: 0">No pipelines found.</p>
    </div>

    <!-- Edit / Create Dialog -->
    <Dialog v-model:visible="displayEditDialog" :style="{width: '650px'}" :header="isNew ? 'Create Pipeline' : 'Edit Pipeline'" :modal="true">
      <div class="form-grid">
        <div class="field flex-1">
          <label for="name" class="field-label">Name</label>
          <InputText id="name" v-model.trim="currentPipeline.name" required autofocus class="w-full" placeholder="Environment Pipeline" />
        </div>
        <div class="field version-field">
          <label for="version" class="field-label">Version</label>
          <InputNumber id="version" v-model="currentPipeline.version" :min="1" class="w-full" />
        </div>
      </div>
      <div class="form-grid">
        <div class="field flex-1">
          <label for="category" class="field-label">Category</label>
          <Select id="category" v-model="currentPipeline.category" :options="store.categories" editable class="w-full" placeholder="Select or type..." />
        </div>
        <div class="field flex-1">
          <label for="tags" class="field-label">Tags</label>
          <InputText id="tags" :modelValue="currentPipeline.tags?.join(', ') || ''" class="w-full" placeholder="Comma separated tags" @update:modelValue="(val: string | undefined) => currentPipeline.tags = val ? val.split(',').map(t=>t.trim()).filter(Boolean) : []" />
        </div>
      </div>

      <div class="options-container">
        <div class="options-header">
          <h3 class="section-title">Modules</h3>
        </div>
        <div class="module-editor-wrapper">
          <PipelineWidget :nodeId="0" v-model="currentPipeline.modules" />
        </div>
      </div>

      <template #footer>
        <Button label="Cancel" icon="pi pi-times" text @click="displayEditDialog = false" />
        <Button label="Save" icon="pi pi-check" @click="savePipeline" :disabled="!currentPipeline.name" />
      </template>
    </Dialog>

    <!-- Delete Confirm Dialog -->
    <Dialog v-model:visible="displayDeleteDialog" :style="{width: '450px'}" header="Confirm Delete" :modal="true">
      <div class="confirm-content">
        <i class="pi pi-exclamation-triangle" style="font-size: 2rem; color: var(--p-orange-400)" />
        <span v-if="itemToDelete">Are you sure you want to delete <b>{{ itemToDelete.name }}</b>?</span>
      </div>
      <template #footer>
        <Button label="No" icon="pi pi-times" text @click="displayDeleteDialog = false" />
        <Button label="Yes" icon="pi pi-check" severity="danger" @click="deletePipeline" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.header-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.search-input {
  flex: 1;
  min-width: 200px;
  max-width: 320px;
}

.category-filter {
  width: 200px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 3rem;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1.25rem;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 4rem 2rem;
}

/* ── Dialog form ── */
.form-grid {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.flex-1 { flex: 1; }

.version-field {
  flex: 0 0 120px;
}

.field-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.w-full { width: 100%; }

.options-container {
  margin-top: 1rem;
  border-top: 1px solid var(--p-surface-200);
  padding-top: 1rem;
}

.options-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.section-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.module-editor-wrapper {
  background: var(--p-surface-100);
  border: 1px solid var(--p-surface-200);
  border-radius: 6px;
  padding: 0.75rem;
}

.confirm-content {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 0;
}
</style>
