<template>
  <div class="module-content">
    <div class="field">
      <label>Capture as</label>
      <input type="text" v-model="localModel.capture_as" @input="emitUpdate" placeholder="$variable_name" />
    </div>
    
    <div class="field">
      <label>Source file</label>
      <input type="text" v-model="localModel.source" @input="emitUpdate" placeholder="location.json" />
    </div>

    <div class="options-section">
      <div class="options-header">
        <label>Options</label>
        <button class="btn-add" @click="addOption">+ Add</button>
      </div>
      
      <div class="options-list">
        <div v-for="(opt, idx) in options" :key="idx" class="option-row">
          <div class="option-inputs">
            <input class="opt-val" type="text" v-model="opt.value" @input="updateOption" placeholder="value" />
            <input class="opt-weight" type="number" v-model.number="opt.weight" @input="updateOption" min="0" step="0.1" />
            <button class="btn-del" @click="removeOption(idx)" title="Remove option">×</button>
          </div>
          <div class="weight-bar-container">
            <div class="weight-bar" :style="{ width: getWeightPercentage(opt.weight) + '%' }"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import type { WildcardModule, WildcardOption } from '@/types';

const props = defineProps<{ modelValue: WildcardModule }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: WildcardModule): void
}>();

const localModel = ref<Omit<WildcardModule, 'options'>>({
  type: 'wildcard',
  capture_as: props.modelValue.capture_as || '',
  source: props.modelValue.source || ''
});

const options = ref<WildcardOption[]>(
  props.modelValue.options ? JSON.parse(JSON.stringify(props.modelValue.options)) : []
);

watch(() => props.modelValue, (newVal) => {
  localModel.value.capture_as = newVal.capture_as;
  localModel.value.source = newVal.source || '';
  if (newVal.options) {
    options.value = JSON.parse(JSON.stringify(newVal.options));
  }
}, { deep: true });

const emitUpdate = () => {
  const payload: WildcardModule = {
    type: 'wildcard',
    capture_as: localModel.value.capture_as,
  };
  if (localModel.value.source) payload.source = localModel.value.source;
  if (options.value.length > 0) payload.options = JSON.parse(JSON.stringify(options.value));
  
  emit('update:modelValue', payload);
};

const maxWeight = computed(() => {
  if (options.value.length === 0) return 1;
  return Math.max(...options.value.map(o => o.weight || 0), 1);
});

const getWeightPercentage = (weight: number) => {
  if (!weight || weight <= 0) return 0;
  return (weight / maxWeight.value) * 100;
};

const addOption = () => {
  options.value.push({ value: '', weight: 1 });
  emitUpdate();
};

const removeOption = (idx: number) => {
  options.value.splice(idx, 1);
  emitUpdate();
};

const updateOption = () => {
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

.options-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 2px;
  padding-top: 4px;
  border-top: 1px solid #333;
}
.options-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.btn-add {
  background: transparent;
  border: none;
  color: #4a9eff;
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}
.btn-add:hover {
  text-decoration: underline;
}

.options-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.option-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.option-inputs {
  display: flex;
  gap: 4px;
  align-items: center;
}
.opt-val {
  flex: 1;
}
.opt-weight {
  width: 50px;
}
.btn-del {
  background: transparent;
  border: none;
  color: #ff4444;
  font-size: 14px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.btn-del:hover {
  color: #ff6666;
}
.weight-bar-container {
  height: 2px;
  background: #2a2a2a;
  border-radius: 1px;
  width: calc(100% - 20px);
  overflow: hidden;
}
.weight-bar {
  height: 100%;
  background: #4a9eff;
  transition: width 0.2s ease;
}
</style>
