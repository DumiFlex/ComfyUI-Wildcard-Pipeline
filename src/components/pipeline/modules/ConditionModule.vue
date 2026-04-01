<template>
  <div class="module-content">
    <div class="field">
      <label>Variable</label>
      <input type="text" v-model="localModel.variable" @input="emitUpdate" placeholder="$variable_name" />
    </div>

    <div class="field">
      <label>Condition Mode</label>
      <div class="radio-group">
        <label class="radio-label">
          <input type="radio" v-model="mode" value="if_equals" @change="onModeChange" />
          If Equals
        </label>
        <label class="radio-label">
          <input type="radio" v-model="mode" value="unless_equals" @change="onModeChange" />
          Unless Equals
        </label>
      </div>
    </div>

    <div class="field">
      <label>Comparison Value</label>
      <input 
        type="text" 
        :value="comparisonValue" 
        @input="onComparisonValueChange" 
        placeholder="value to compare" 
      />
    </div>

    <div class="field">
      <label>Value (if condition met)</label>
      <input type="text" v-model="localModel.value" @input="emitUpdate" placeholder="value when condition met" />
    </div>

    <div class="field">
      <label>Fallback (optional)</label>
      <input type="text" v-model="localModel.fallback" @input="emitUpdate" placeholder="fallback value" />
    </div>

    <div class="field">
      <label>Capture as</label>
      <input type="text" v-model="localModel.capture_as" @input="emitUpdate" placeholder="$result_variable" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import type { ConditionModule } from '@/types';

const props = defineProps<{ modelValue: ConditionModule }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: ConditionModule): void
}>();

const localModel = ref<ConditionModule>(JSON.parse(JSON.stringify(props.modelValue)));

const mode = ref<'if_equals' | 'unless_equals'>(localModel.value.unless_equals !== undefined ? 'unless_equals' : 'if_equals');

const comparisonValue = computed(() => {
  return mode.value === 'if_equals' ? localModel.value.if_equals : localModel.value.unless_equals;
});

watch(() => props.modelValue, (newVal) => {
  localModel.value = JSON.parse(JSON.stringify(newVal));
  mode.value = localModel.value.unless_equals !== undefined ? 'unless_equals' : 'if_equals';
}, { deep: true });

const emitUpdate = () => {
  emit('update:modelValue', JSON.parse(JSON.stringify(localModel.value)));
};

const onModeChange = () => {
  const currentVal = comparisonValue.value || '';
  if (mode.value === 'if_equals') {
    localModel.value.if_equals = currentVal;
    delete localModel.value.unless_equals;
  } else {
    localModel.value.unless_equals = currentVal;
    delete localModel.value.if_equals;
  }
  emitUpdate();
};

const onComparisonValueChange = (event: Event) => {
  const val = (event.target as HTMLInputElement).value;
  if (mode.value === 'if_equals') {
    localModel.value.if_equals = val;
  } else {
    localModel.value.unless_equals = val;
  }
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
.radio-group {
  display: flex;
  gap: 12px;
  margin-top: 2px;
  margin-bottom: 2px;
}
.radio-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #e0e0e0;
  cursor: pointer;
}
.radio-label input[type="radio"] {
  width: auto;
  margin: 0;
  cursor: pointer;
}
</style>