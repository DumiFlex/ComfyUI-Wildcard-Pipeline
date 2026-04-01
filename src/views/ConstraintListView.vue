<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useConstraintStore } from '../stores/constraints'
import type { ConstraintData } from '../api/client'
import type { ConstraintRule } from '../types'
import { useToast } from 'primevue/usetoast'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import Button from 'primevue/button'
import ResourceCard from '../components/manager/ResourceCard.vue'

const store = useConstraintStore()
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

type EditorConstraint = Omit<ConstraintData, 'rules'> & { rules: ConstraintRule[] }

const currentConstraint = ref<EditorConstraint>({ id: '', name: '', rules: [] })
const itemToDelete = ref<ConstraintData | null>(null)

const ruleTypes = [
  { label: 'Exclusion', value: 'exclusion' },
  { label: 'Weight Bias', value: 'weight_bias' }
]

const filteredItems = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return store.filteredItems
  return store.filteredItems.filter(item =>
    item.name.toLowerCase().includes(q) ||
    item.tags?.some(t => t.toLowerCase().includes(q))
  )
})

const getTargets = (ct: ConstraintData): string => {
  const unique = [...new Set(ct.rules.map(r => ('target' in r ? r.target : '')).filter(Boolean))]
  if (unique.length <= 3) return unique.join(', ')
  return unique.slice(0, 3).join(', ') + '...'
}

function getStats(item: ConstraintData) {
  return [
    { label: 'Rules', value: item.rules?.length ?? 0 },
    { label: 'Targets', value: getTargets(item) || '—' },
  ]
}

const openNew = () => {
  currentConstraint.value = { id: '', name: '', rules: [] }
  isNew.value = true
  displayEditDialog.value = true
}

const editConstraint = (data: ConstraintData) => {
  const parsed = JSON.parse(JSON.stringify(data))
  parsed.rules = parsed.rules.map((r: ConstraintRule | { when_value: string; rule_type: 'exclusion' | 'weight_bias'; values: string[]; multiplier?: number }) => ({
    target: 'target' in r ? r.target : '',
    when_variable: 'when_variable' in r ? r.when_variable : '',
    when_value: r.when_value || '',
    rule_type: r.rule_type || 'exclusion',
    values: r.values || [],
    multiplier: r.multiplier
  }))
  currentConstraint.value = parsed
  isNew.value = false
  displayEditDialog.value = true
}

const confirmDelete = (item: ConstraintData) => {
  itemToDelete.value = item
  displayDeleteDialog.value = true
}

const addRule = () => {
  currentConstraint.value.rules.push({ target: '', when_variable: '', when_value: '', rule_type: 'exclusion', values: [] })
}

const removeRule = (index: number) => {
  currentConstraint.value.rules.splice(index, 1)
}

const saveConstraint = async () => {
  try {
    if (isNew.value) {
      await store.create(currentConstraint.value)
      toast.add({ severity: 'success', summary: 'Created', detail: `Constraint ${currentConstraint.value.name} created`, life: 3000 })
    } else {
      await store.update(currentConstraint.value.id!, currentConstraint.value)
      toast.add({ severity: 'success', summary: 'Updated', detail: `Constraint ${currentConstraint.value.name} updated`, life: 3000 })
    }
    displayEditDialog.value = false
  } catch (error: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: error.message || 'Operation failed', life: 5000 })
  }
}

const deleteConstraint = async () => {
  if (itemToDelete.value && itemToDelete.value.id) {
    try {
      await store.remove(itemToDelete.value.id)
      toast.add({ severity: 'success', summary: 'Deleted', detail: `Constraint ${itemToDelete.value.name} deleted`, life: 3000 })
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
      <Button label="New Constraint" icon="pi pi-plus" @click="openNew" />
      <InputText v-model="searchQuery" placeholder="Search constraints..." class="search-input" />
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
      <span style="color: var(--p-text-muted-color)">Loading constraints…</span>
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
        icon="pi pi-filter"
        @edit="editConstraint(item)"
        @delete="confirmDelete(item)"
      />
    </div>

    <!-- Empty state -->
    <div v-else class="empty-state">
      <i class="pi pi-inbox" style="font-size: 2.5rem; color: var(--p-text-muted-color)" />
      <p style="color: var(--p-text-muted-color); margin: 0">No constraints found.</p>
    </div>

    <!-- Edit / Create Dialog -->
    <Dialog v-model:visible="displayEditDialog" :style="{width: '1050px'}" :header="isNew ? 'Create Constraint' : 'Edit Constraint'" :modal="true">
      <div class="form-row">
        <div class="field w-full">
          <label for="name" class="field-label">Name</label>
          <InputText id="name" v-model.trim="currentConstraint.name" required autofocus class="w-full" placeholder="e.g. lighting-weather" />
        </div>
        <div class="field w-full">
          <label for="category" class="field-label">Category</label>
          <Select id="category" v-model="currentConstraint.category" :options="store.categories" editable class="w-full" placeholder="Select or type..." />
        </div>
        <div class="field w-full">
          <label for="tags" class="field-label">Tags</label>
          <InputText id="tags" :modelValue="currentConstraint.tags?.join(', ') || ''" class="w-full" placeholder="Comma separated tags" @update:modelValue="(val: string | undefined) => currentConstraint.tags = val ? val.split(',').map(t=>t.trim()).filter(Boolean) : []" />
        </div>
      </div>

      <div class="options-container">
        <div class="options-header">
          <h3 class="section-title">Rules</h3>
          <Button icon="pi pi-plus" label="Add Rule" size="small" @click="addRule" />
        </div>

        <div class="options-list">
          <div v-for="(rule, idx) in currentConstraint.rules" :key="idx" class="option-row">
            <div class="option-drag-handle"><i class="pi pi-bars"></i></div>
            <div class="rule-inputs">
              <InputText v-model="rule.target" placeholder="Target var" class="rule-field" />
              <InputText v-model="rule.when_variable" placeholder="When var" class="rule-field" />
              <InputText v-model="rule.when_value" placeholder="When value" class="rule-field" />
              <Select v-model="rule.rule_type" :options="ruleTypes" optionLabel="label" optionValue="value" placeholder="Type" class="rule-type" />
              <InputText
                :modelValue="rule.values ? rule.values.join(', ') : ''"
                placeholder="Values (comma sep)"
                class="rule-values"
                @update:modelValue="(val: string | undefined) => rule.values = val ? val.split(',').map(v=>v.trim()).filter(Boolean) : []"
              />
              <InputNumber
                v-if="rule.rule_type === 'weight_bias'"
                v-model="rule.multiplier"
                :min="0" :max="100" :step="0.1"
                placeholder="Mult"
                class="rule-mult"
                showButtons
              />
            </div>
            <Button icon="pi pi-trash" severity="danger" text @click="removeRule(idx)" />
          </div>
          <div v-if="currentConstraint.rules.length === 0" class="empty-options">
            No rules defined. Add one to get started.
          </div>
        </div>
      </div>

      <template #footer>
        <Button label="Cancel" icon="pi pi-times" text @click="displayEditDialog = false" />
        <Button label="Save" icon="pi pi-check" @click="saveConstraint" :disabled="!currentConstraint.name || currentConstraint.rules.length === 0" />
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
        <Button label="Yes" icon="pi pi-check" severity="danger" @click="deleteConstraint" />
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
.form-row {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
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
  max-height: 460px;
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

.rule-inputs {
  display: flex;
  gap: 0.5rem;
  flex: 1;
  align-items: center;
  flex-wrap: wrap;
}

.rule-field { width: 140px; }
.rule-type { width: 130px; }
.rule-values { flex: 1; min-width: 140px; }
.rule-mult { width: 100px; }

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
