<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { usePipelineStore } from '../stores/pipelines'
import type { PipelineData } from '../api/client'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import OrderList from 'primevue/orderlist'

const store = usePipelineStore()

onMounted(() => {
  store.fetchAll()
})

const displayEditDialog = ref(false)
const displayDeleteDialog = ref(false)
const isNew = ref(false)

const currentPipeline = ref<PipelineData>({ name: '', version: 1, modules: [] })
const itemToDelete = ref<string | null>(null)

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

const confirmDelete = (name: string) => {
  itemToDelete.value = name
  displayDeleteDialog.value = true
}

const savePipeline = async () => {
  if (isNew.value) {
    await store.create(currentPipeline.value)
  } else {
    await store.update(currentPipeline.value.name, currentPipeline.value)
  }
  displayEditDialog.value = false
}

const deletePipeline = async () => {
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
      <Button label="New Pipeline" icon="pi pi-plus" @click="openNew" />
      <Button icon="pi pi-refresh" class="p-button-secondary" @click="store.fetchAll" :loading="store.loading" />
    </div>

    <DataTable :value="store.items" :loading="store.loading" class="data-table">
      <Column field="name" header="Name" sortable></Column>
      <Column field="version" header="Version" sortable></Column>
      <Column header="Modules">
        <template #body="{ data }">
          {{ data.modules.length }} modules
        </template>
      </Column>
      <Column header="Actions" :exportable="false" style="min-width:8rem">
        <template #body="slotProps">
          <Button icon="pi pi-pencil" outlined rounded class="mr-2" @click="editPipeline(slotProps.data)" />
          <Button icon="pi pi-trash" outlined rounded severity="danger" @click="confirmDelete(slotProps.data.name)" />
        </template>
      </Column>
    </DataTable>

    <Dialog v-model:visible="displayEditDialog" :style="{width: '650px'}" :header="isNew ? 'Create Pipeline' : 'Edit Pipeline'" :modal="true">
      <div class="field">
        <label for="name">Name</label>
        <InputText id="name" v-model.trim="currentPipeline.name" required autofocus :disabled="!isNew" class="w-full" />
      </div>
      
      <div class="options-container">
        <div class="options-header">
          <h3>Modules Ordering</h3>
        </div>
        
        <OrderList v-model="currentPipeline.modules" listStyle="height:auto" dataKey="capture_as">
          <template #item="slotProps">
            <div class="module-item">
              <span class="module-type">{{ slotProps.item.type }}</span>
              <span class="module-capture">as <b>{{ slotProps.item.capture_as || 'N/A' }}</b></span>
            </div>
          </template>
        </OrderList>
      </div>
      
      <template #footer>
        <Button label="Cancel" icon="pi pi-times" text @click="displayEditDialog = false" />
        <Button label="Save" icon="pi pi-check" @click="savePipeline" :disabled="!currentPipeline.name" />
      </template>
    </Dialog>

    <Dialog v-model:visible="displayDeleteDialog" :style="{width: '450px'}" header="Confirm" :modal="true">
      <div class="confirmation-content">
        <i class="pi pi-exclamation-triangle mr-3" style="font-size: 2rem" />
        <span v-if="itemToDelete">Are you sure you want to delete <b>{{ itemToDelete }}</b>?</span>
      </div>
      <template #footer>
        <Button label="No" icon="pi pi-times" text @click="displayDeleteDialog = false" />
        <Button label="Yes" icon="pi pi-check" severity="danger" @click="deletePipeline" />
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
  border-radius: var(--radius-md);
}
.field { margin-bottom: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
.w-full { width: 100%; }
.mr-2 { margin-right: 0.5rem; }
.mr-3 { margin-right: 1rem; }
.options-container { margin-top: var(--space-6); border-top: 1px solid var(--border-color); padding-top: var(--space-4); }
.options-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-4); }
.module-item {
  display: flex;
  justify-content: space-between;
  padding: var(--space-2) var(--space-4);
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
}
.module-type {
  font-weight: bold;
  color: var(--accent-primary);
  text-transform: uppercase;
}
</style>
