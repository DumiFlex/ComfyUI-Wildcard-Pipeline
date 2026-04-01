<template>
  <div class="module-content">
    <div class="field">
      <label>Capture as</label>
      <input type="text" v-model="localModel.capture_as" @input="emitUpdate" placeholder="$variable_name" />
    </div>
    <div class="field">
      <label>Template</label>
      <textarea v-model="localModel.template" @input="emitUpdate" placeholder="$location, $lighting"></textarea>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { CombineModule } from '@/types';

const props = defineProps<{ modelValue: CombineModule }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: CombineModule): void
}>();

const localModel = ref<CombineModule>({ ...props.modelValue });

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
input, textarea {
  width: 100%;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid #444;
  background: #2a2a2a;
  color: #e0e0e0;
  font-size: 12px;
  box-sizing: border-box;
  outline: none;
  font-family: inherit;
}
textarea {
  resize: vertical;
  min-height: 40px;
}
input:focus, textarea:focus {
  border-color: #4a9eff;
}
</style>
