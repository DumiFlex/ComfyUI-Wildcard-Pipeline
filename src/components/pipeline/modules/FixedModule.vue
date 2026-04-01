<template>
  <div class="module-content">
    <div class="field">
      <label>Capture as</label>
      <input type="text" v-model="localModel.capture_as" @input="emitUpdate" placeholder="$variable_name" />
    </div>
    <div class="field">
      <label>Value</label>
      <input type="text" v-model="localModel.value" @input="emitUpdate" placeholder="Enter fixed value" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { FixedModule } from '@/types';

const props = defineProps<{ modelValue: FixedModule }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: FixedModule): void
}>();

const localModel = ref<FixedModule>({ ...props.modelValue });

watch(() => props.modelValue, (newVal) => {
  localModel.value = { ...newVal };
}, { deep: true });

const emitUpdate = () => {
  emit('update:modelValue', { ...localModel.value });
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
