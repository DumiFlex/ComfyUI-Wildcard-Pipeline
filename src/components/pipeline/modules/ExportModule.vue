<template>
  <div class="module-content">
    <div class="field">
      <label>Variables (comma-separated)</label>
      <input type="text" :value="variablesString" @input="updateVariables" placeholder="$var1, $var2" />
    </div>
    
    <div class="field">
      <label>Prefix (optional)</label>
      <input type="text" v-model="localModel.prefix" @input="emitUpdate" placeholder="namespace_" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import type { ExportModule } from '@/types';

const props = defineProps<{ modelValue: ExportModule }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: ExportModule): void
}>();

const localModel = ref<ExportModule>(JSON.parse(JSON.stringify(props.modelValue)));

watch(() => props.modelValue, (newVal) => {
  localModel.value = JSON.parse(JSON.stringify(newVal));
}, { deep: true });

const emitUpdate = () => {
  emit('update:modelValue', JSON.parse(JSON.stringify(localModel.value)));
};

const variablesString = computed(() => {
  return (localModel.value.variables || []).join(', ');
});

const updateVariables = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const vars = input.value.split(',').map(v => v.trim()).filter(v => v);
  localModel.value.variables = vars;
  emitUpdate();
};
</script>

<style scoped>
.module-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
label {
  font-size: 11px;
  color: #a0a0a0;
}
input {
  width: 100%;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid #444;
  background: #2a2a2a;
  color: #e0e0e0;
  font-size: 12px;
  box-sizing: border-box;
  outline: none;
}
input:focus {
  border-color: #4a9eff;
}
</style>