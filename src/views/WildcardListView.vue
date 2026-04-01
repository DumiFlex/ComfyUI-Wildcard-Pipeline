<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useWildcardStore } from '../stores/wildcards'
import type { WildcardData } from '../api/client'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Button from 'primevue/button'
import Chip from 'primevue/chip'

const store = useWildcardStore()

onMounted(() => {
  store.fetchAll()
})

const displayEditDialog = ref(false)
const displayDeleteDialog = ref(false)
const isNew = ref(false)

const currentWildcard = ref<WildcardData>({ name: '', version: 1, options: [] })
const itemToDelete = ref<string | null>(null)

const openNew = () => {
  currentWildcard.value = { name: '', version: 1, options: [] }
  isNew.value = true
  displayEditDialog.value = true
}

const editWildcard = (data: WildcardData) => {
  currentWildcard.value = JSON.parse(JSON.stringify(data))
  isNew.value = false
  displayEditDialog.value = true
}

const confirmDelete = (name: string) => {
  itemToDelete.value = name
  displayDeleteDialog.value = true
}

const addOption = () => {
  currentWildcard.value.options.push({ value: '', weight: 1, tags: [] })
}

const removeOption = (index: number) => {
  currentWildcard.value.options.splice(index, 1)
}

const saveWildcard = async () => {
  if (isNew.value) {
    await store.create(currentWildcard.value)
  } else {
    await store.update(currentWildcard.value.name, currentWildcard.value)
  }
  displayEditDialog.value = false
}

const deleteWildcard = async () => {
  if (itemToDelete.value) {
    await store.remove(itemToDelete.value)
    displayDeleteDialog.value = false
    itemToDelete.value = null
  }
}
</script>

<template>
  <div class="view-container">
    <div class="header-actions">
      <Button label="New Wildcard" icon="pi pi-plus" @click="openNew" />
      <Button icon="pi pi-refresh" class="p-button-secondary" @click="store.fetchAll" :loading="store.loading" />
    </div>

    <DataTable :value="store.items" :loading="store.loading" class="data-table">
      <Column field="name" header="Name" sortable></Column>
      <Column field="version" header="Version" sortable></Column>
      <Column header="Options Count">
        <template #body="{ data }">
          {{ data.options.length }}
        </template>
      </Column>
      <Column header="Actions" :exportable="false" style="min-width:8rem">
        <template #body="slotProps">
          <Button icon="pi pi-pencil" outlined rounded class="mr-2" @click="editWildcard(slotProps.data)" />
          <Button icon="pi pi-trash" outlined rounded severity="danger" @click="confirmDelete(slotProps.data.name)" />
        </template>
      </Column>
    </DataTable>

    <Dialog v-model:visible="displayEditDialog" :style="{width: '600px'}" :header="isNew ? 'Create Wildcard' : 'Edit Wildcard'" :modal="true" class="edit-dialog">
      <div class="field">
        <label for="name">Name</label>
        <InputText id="name" v-model.trim="currentWildcard.name" required autofocus :disabled="!isNew" class="w-full" />
      </div>
      
      <div class="options-container">
        <div class="options-header">
          <h3>Options</h3>
          <Button icon="pi pi-plus" label="Add" size="small" @click="addOption" />
        </div>
        
        <div v-for="(opt, idx) in currentWildcard.options" :key="idx" class="option-row">
          <div class="option-inputs">
            <InputText v-model="opt.value" placeholder="Value" class="opt-value" />
            <InputNumber v-model="opt.weight" :min="0" :max="100" :step="0.1" placeholder="Weight" class="opt-weight" />
            <InputText :modelValue="opt.tags?.join(', ') || ''" placeholder="Tags (comma sep)" class="opt-tags" @update:modelValue="(val: string | undefined) => opt.tags = val ? val.split(',').map(t=>t.trim()).filter(Boolean) : []" />
          </div>
          <Button icon="pi pi-times" severity="danger" text @click="removeOption(idx)" />
        </div>
      </div>
      
      <template #footer>
        <Button label="Cancel" icon="pi pi-times" text @click="displayEditDialog = false" />
        <Button label="Save" icon="pi pi-check" @click="saveWildcard" :disabled="!currentWildcard.name" />
      </template>
    </Dialog>

    <Dialog v-model:visible="displayDeleteDialog" :style="{width: '450px'}" header="Confirm" :modal="true">
      <div class="confirmation-content">
        <i class="pi pi-exclamation-triangle mr-3" style="font-size: 2rem" />
        <span v-if="itemToDelete">Are you sure you want to delete <b>{{ itemToDelete }}</b>?</span>
      </div>
      <template #footer>
        <Button label="No" icon="pi pi-times" text @click="displayDeleteDialog = false" />
        <Button label="Yes" icon="pi pi-check" severity="danger" @click="deleteWildcard" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.header-actions {
  display: flex;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

.data-table {
  background-color: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
}

.field {
  margin-bottom: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.w-full {
  width: 100%;
}

.mr-2 {
  margin-right: 0.5rem;
}

.mr-3 {
  margin-right: 1rem;
}

.options-container {
  margin-top: var(--space-6);
  border-top: 1px solid var(--border-color);
  padding-top: var(--space-4);
}

.options-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-4);
}

.option-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
  background: var(--bg-surface);
  padding: var(--space-2);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
}

.option-inputs {
  display: flex;
  gap: var(--space-2);
  flex: 1;
}

.opt-value { flex: 2; }
.opt-weight { width: 80px; }
.opt-tags { flex: 1; }
</style>
