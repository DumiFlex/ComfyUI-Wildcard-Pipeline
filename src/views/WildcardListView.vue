<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useWildcardStore } from '../stores/wildcards'
import type { WildcardData } from '../api/client'
import { useToast } from 'primevue/usetoast'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Button from 'primevue/button'
import Select from 'primevue/select'
import ResourceCard from '../components/manager/ResourceCard.vue'

const store = useWildcardStore()
const toast = useToast()

onMounted(async () => {
  await Promise.all([
    store.fetchAll(),
    store.fetchCategories(),
    store.fetchTags()
  ])
})

const displayEditDialog = ref(false)
const displayDeleteDialog = ref(false)
const isNew = ref(false)

const searchQuery = ref('')

const currentWildcard = ref<Partial<WildcardData>>({ name: '', version: 1, options: [], tags: [], category: '' })
const itemToDelete = ref<WildcardData | null>(null)

const dialogTagsString = ref('')

const filteredItems = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return store.filteredItems
  return store.filteredItems.filter(item =>
    item.name.toLowerCase().includes(q) ||
    item.tags?.some(t => t.toLowerCase().includes(q))
  )
})

const openNew = () => {
  currentWildcard.value = { name: '', version: 1, options: [], tags: [], category: '' }
  dialogTagsString.value = ''
  isNew.value = true
  displayEditDialog.value = true
}

const editWildcard = (data: WildcardData) => {
  currentWildcard.value = JSON.parse(JSON.stringify(data))
  dialogTagsString.value = currentWildcard.value.tags?.join(', ') || ''
  isNew.value = false
  displayEditDialog.value = true
}

const confirmDelete = (item: WildcardData) => {
  itemToDelete.value = item
  displayDeleteDialog.value = true
}

const addOption = () => {
  if (!currentWildcard.value.options) {
    currentWildcard.value.options = []
  }
  currentWildcard.value.options.push({ value: '', weight: 1, tags: [] })
}

const removeOption = (index: number) => {
  currentWildcard.value.options?.splice(index, 1)
}

const saveWildcard = async () => {
  try {
    currentWildcard.value.tags = dialogTagsString.value
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)

    if (isNew.value) {
      await store.create(currentWildcard.value as Omit<WildcardData, 'id'>)
      toast.add({ severity: 'success', summary: 'Created', detail: `Wildcard ${currentWildcard.value.name} created`, life: 3000 })
    } else {
      if (!currentWildcard.value.id) throw new Error("Missing ID for update")
      await store.update(currentWildcard.value.id, currentWildcard.value as WildcardData)
      toast.add({ severity: 'success', summary: 'Updated', detail: `Wildcard ${currentWildcard.value.name} updated`, life: 3000 })
    }
    displayEditDialog.value = false
  } catch (error: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: error.message || 'Operation failed', life: 5000 })
  }
}

const deleteWildcard = async () => {
  if (itemToDelete.value?.id) {
    try {
      await store.remove(itemToDelete.value.id)
      toast.add({ severity: 'success', summary: 'Deleted', detail: `Wildcard ${itemToDelete.value.name} deleted`, life: 3000 })
      displayDeleteDialog.value = false
      itemToDelete.value = null
    } catch (error: any) {
      toast.add({ severity: 'error', summary: 'Error', detail: error.message || 'Operation failed', life: 5000 })
    }
  }
}

function getStats(item: WildcardData) {
  return [
    { label: 'Options', value: item.options?.length ?? 0 },
    { label: 'Version', value: `v${item.version}` },
  ]
}
</script>

<template>
  <div class="view-container">
    <!-- Header bar -->
    <div class="header-bar">
      <Button label="New Wildcard" icon="pi pi-plus" @click="openNew" />
      <InputText v-model="searchQuery" placeholder="Search wildcards..." class="search-input" />
      <Select
        v-model="store.selectedCategory"
        :options="store.categories"
        placeholder="All Categories"
        showClear
        class="category-filter"
      />
      <Button icon="pi pi-refresh" text @click="store.fetchAll" :loading="store.loading" />
    </div>

    <!-- Loading skeleton -->
    <div v-if="store.loading && filteredItems.length === 0" class="loading-state">
      <i class="pi pi-spin pi-spinner" style="font-size: 1.5rem; color: var(--p-text-muted-color)" />
      <span style="color: var(--p-text-muted-color)">Loading wildcards…</span>
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
        icon="pi pi-tags"
        @edit="editWildcard(item)"
        @delete="confirmDelete(item)"
      />
    </div>

    <!-- Empty state -->
    <div v-else class="empty-state">
      <i class="pi pi-inbox" style="font-size: 2.5rem; color: var(--p-text-muted-color)" />
      <p style="color: var(--p-text-muted-color); margin: 0">No wildcards found.</p>
    </div>

    <!-- Edit / Create Dialog -->
    <Dialog v-model:visible="displayEditDialog" :style="{width: '700px'}" :header="isNew ? 'Create Wildcard' : 'Edit Wildcard'" :modal="true">
      <div class="form-grid">
        <div class="field">
          <label for="name" class="field-label">Name</label>
          <InputText id="name" v-model.trim="currentWildcard.name" required autofocus class="w-full" placeholder="e.g. location" />
        </div>
        <div class="field version-field">
          <label for="version" class="field-label">Version</label>
          <InputNumber id="version" v-model="currentWildcard.version" :min="1" class="w-full" />
        </div>
      </div>

      <div class="form-grid">
        <div class="field">
          <label for="category" class="field-label">Category</label>
          <InputText id="category" list="categories-list" v-model.trim="currentWildcard.category" placeholder="e.g. environment" class="w-full" />
          <datalist id="categories-list">
            <option v-for="cat in store.categories" :key="cat" :value="cat"></option>
          </datalist>
        </div>
        <div class="field">
          <label for="tags" class="field-label">Tags (comma separated)</label>
          <InputText id="tags" v-model="dialogTagsString" placeholder="e.g. realistic, outdoor" class="w-full" />
        </div>
      </div>

      <div class="options-container">
        <div class="options-header">
          <h3 class="section-title">Options</h3>
          <Button icon="pi pi-plus" label="Add Option" size="small" @click="addOption" />
        </div>

        <div class="options-list">
          <div v-for="(opt, idx) in currentWildcard.options" :key="idx" class="option-row">
            <div class="option-drag-handle"><i class="pi pi-bars"></i></div>
            <div class="option-inputs">
              <InputText v-model="opt.value" placeholder="Option value" class="opt-value" />
              <InputNumber v-model="opt.weight" :min="0" :max="1000" :step="0.1" placeholder="Weight" class="opt-weight" showButtons />
              <InputText
                :modelValue="opt.tags?.join(', ') || ''"
                placeholder="Tags (comma sep)"
                class="opt-tags"
                @update:modelValue="(val: string | undefined) => opt.tags = val ? val.split(',').map(t=>t.trim()).filter(Boolean) : []"
              />
            </div>
            <Button icon="pi pi-trash" severity="danger" text @click="removeOption(idx)" />
          </div>
          <div v-if="!currentWildcard.options || currentWildcard.options.length === 0" class="empty-options">
            No options defined. Add one to get started.
          </div>
        </div>
      </div>

      <template #footer>
        <Button label="Cancel" icon="pi pi-times" text @click="displayEditDialog = false" />
        <Button label="Save" icon="pi pi-check" @click="saveWildcard" :disabled="!currentWildcard.name || !currentWildcard.options || currentWildcard.options.length === 0" />
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
        <Button label="Yes" icon="pi pi-check" severity="danger" @click="deleteWildcard" />
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
  flex: 1;
}

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

.options-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 380px;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.option-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--p-surface-100);
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--p-surface-200);
  border-radius: 6px;
  transition: border-color 0.15s;
}

.option-row:hover {
  border-color: var(--p-primary-color);
}

.option-drag-handle {
  color: var(--p-text-muted-color);
  cursor: grab;
  flex-shrink: 0;
}

.option-inputs {
  display: flex;
  gap: 0.5rem;
  flex: 1;
  align-items: center;
}

.opt-value { flex: 2; min-width: 0; }
.opt-weight { width: 110px; }
.opt-tags { flex: 2; min-width: 0; }

.empty-options {
  text-align: center;
  padding: 1.5rem;
  color: var(--p-text-muted-color);
  font-size: 0.875rem;
  border: 1px dashed var(--p-surface-300);
  border-radius: 6px;
}

.confirm-content {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 0;
}
</style>
