<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useConstraintStore } from '../stores/constraints'
import type { ConstraintData } from '../api/client'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Dropdown from 'primevue/dropdown'
import Button from 'primevue/button'

const store = useConstraintStore()

onMounted(() => {
  store.fetchAll()
})

const displayEditDialog = ref(false)
const displayDeleteDialog = ref(false)
const isNew = ref(false)

const currentConstraint = ref<ConstraintData>({ name: '', rules: [] })
const itemToDelete = ref<string | null>(null)

const ruleTypes = [
  { label: 'Exclusion', value: 'exclusion' },
  { label: 'Weight Bias', value: 'weight_bias' }
]

const openNew = () => {
  currentConstraint.value = { name: '', rules: [] }
  isNew.value = true
  displayEditDialog.value = true
}

const editConstraint = (data: ConstraintData) => {
  currentConstraint.value = JSON.parse(JSON.stringify(data))
  isNew.value = false
  displayEditDialog.value = true
}

const confirmDelete = (name: string) => {
  itemToDelete.value = name
  displayDeleteDialog.value = true
}

const addRule = () => {
  currentConstraint.value.rules.push({ when_value: '', rule_type: 'exclusion', values: [] })
}

const removeRule = (index: number) => {
  currentConstraint.value.rules.splice(index, 1)
}

const saveConstraint = async () => {
  if (isNew.value) {
    await store.create(currentConstraint.value)
  } else {
    await store.update(currentConstraint.value.name, currentConstraint.value)
  }
  displayEditDialog.value = false
}

const deleteConstraint = async () => {
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
      <Button label="New Constraint" icon="pi pi-plus" @click="openNew" />
      <Button icon="pi pi-refresh" class="p-button-secondary" @click="store.fetchAll" :loading="store.loading" />
    </div>

    <DataTable :value="store.items" :loading="store.loading" class="data-table">
      <Column field="name" header="Name" sortable></Column>
      <Column header="Rules Count">
        <template #body="{ data }">
          {{ data.rules.length }}
        </template>
      </Column>
      <Column header="Actions" :exportable="false" style="min-width:8rem">
        <template #body="slotProps">
          <Button icon="pi pi-pencil" outlined rounded class="mr-2" @click="editConstraint(slotProps.data)" />
          <Button icon="pi pi-trash" outlined rounded severity="danger" @click="confirmDelete(slotProps.data.name)" />
        </template>
      </Column>
    </DataTable>

    <Dialog v-model:visible="displayEditDialog" :style="{width: '650px'}" :header="isNew ? 'Create Constraint' : 'Edit Constraint'" :modal="true">
      <div class="field">
        <label for="name">Name</label>
        <InputText id="name" v-model.trim="currentConstraint.name" required autofocus :disabled="!isNew" class="w-full" />
      </div>
      
      <div class="options-container">
        <div class="options-header">
          <h3>Rules</h3>
          <Button icon="pi pi-plus" label="Add Rule" size="small" @click="addRule" />
        </div>
        
        <div v-for="(rule, idx) in currentConstraint.rules" :key="idx" class="option-row">
          <div class="option-inputs">
            <InputText v-model="rule.when_value" placeholder="When Value" class="rule-when" />
            <Dropdown v-model="rule.rule_type" :options="ruleTypes" optionLabel="label" optionValue="value" placeholder="Type" class="rule-type" />
            <InputText :modelValue="rule.values.join(', ')" placeholder="Target Values (csv)" class="rule-values" @update:modelValue="(val: string | undefined) => rule.values = val ? val.split(',').map(v=>v.trim()).filter(Boolean) : []" />
            <InputNumber v-if="rule.rule_type === 'weight_bias'" v-model="rule.multiplier" :min="0" :max="10" :step="0.1" placeholder="Mult" class="rule-mult" />
          </div>
          <Button icon="pi pi-times" severity="danger" text @click="removeRule(idx)" />
        </div>
      </div>
      
      <template #footer>
        <Button label="Cancel" icon="pi pi-times" text @click="displayEditDialog = false" />
        <Button label="Save" icon="pi pi-check" @click="saveConstraint" :disabled="!currentConstraint.name" />
      </template>
    </Dialog>

    <Dialog v-model:visible="displayDeleteDialog" :style="{width: '450px'}" header="Confirm" :modal="true">
      <div class="confirmation-content">
        <i class="pi pi-exclamation-triangle mr-3" style="font-size: 2rem" />
        <span v-if="itemToDelete">Are you sure you want to delete <b>{{ itemToDelete }}</b>?</span>
      </div>
      <template #footer>
        <Button label="No" icon="pi pi-times" text @click="displayDeleteDialog = false" />
        <Button label="Yes" icon="pi pi-check" severity="danger" @click="deleteConstraint" />
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
.option-row { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-2); background: var(--bg-surface); padding: var(--space-2); border: 1px solid var(--border-color); border-radius: var(--radius-sm); }
.option-inputs { display: flex; gap: var(--space-2); flex: 1; }
.rule-when { width: 120px; }
.rule-type { width: 150px; }
.rule-values { flex: 1; }
.rule-mult { width: 80px; }
</style>
