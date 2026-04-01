<template>
  <div class="module-content">
    <div class="field">
      <label>Target</label>
      <input type="text" v-model="localModel.target" @input="emitUpdate" placeholder="$variable_name" />
    </div>
    
    <div class="field">
      <label>Source (optional)</label>
      <input type="text" v-model="localModel.source" @input="emitUpdate" placeholder="constraint_file.json" />
    </div>

    <div class="field">
      <label>Capture as (optional)</label>
      <input type="text" v-model="localModel.capture_as" @input="emitUpdate" placeholder="$result_variable" />
    </div>

    <div class="rules-section">
      <label>Rules</label>
      <div v-for="(rule, index) in localModel.rules || []" :key="index" class="rule-card">
        <div class="rule-header">
          <span>Rule {{ index + 1 }}</span>
          <button class="btn-delete" @click="removeRule(index)" title="Remove rule">×</button>
        </div>
        
        <div class="field">
          <label>When value equals</label>
          <input type="text" v-model="rule.when_value" @input="emitUpdate" placeholder="value" />
        </div>
        
        <div class="field">
          <label>Rule Type</label>
          <select v-model="rule.rule_type" @change="emitUpdate" class="type-select">
            <option value="exclusion">Exclusion</option>
            <option value="weight_bias">Weight Bias</option>
          </select>
        </div>
        
        <div class="field">
          <label>Values (comma-separated)</label>
          <input type="text" :value="rule.values.join(', ')" @input="updateValues(index, $event)" placeholder="val1, val2" />
        </div>
        
        <div class="field" v-if="rule.rule_type === 'weight_bias'">
          <label>Multiplier</label>
          <input type="number" step="0.1" v-model.number="rule.multiplier" @input="emitUpdate" placeholder="1.5" />
        </div>
      </div>
      
      <button class="btn-add-rule" @click="addRule">+ Add Rule</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ConstrainModule, ConstraintRule } from '@/types';

const props = defineProps<{ modelValue: ConstrainModule }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: ConstrainModule): void
}>();

const localModel = ref<ConstrainModule>(JSON.parse(JSON.stringify(props.modelValue)));

watch(() => props.modelValue, (newVal) => {
  localModel.value = JSON.parse(JSON.stringify(newVal));
}, { deep: true });

const emitUpdate = () => {
  emit('update:modelValue', JSON.parse(JSON.stringify(localModel.value)));
};

const updateValues = (index: number, event: Event) => {
  const input = event.target as HTMLInputElement;
  const vals = input.value.split(',').map(v => v.trim()).filter(v => v);
  if (localModel.value.rules) {
    localModel.value.rules[index].values = vals;
    emitUpdate();
  }
};

const addRule = () => {
  if (!localModel.value.rules) {
    localModel.value.rules = [];
  }
  localModel.value.rules.push({
    when_value: '',
    rule_type: 'exclusion',
    values: []
  });
  emitUpdate();
};

const removeRule = (index: number) => {
  if (localModel.value.rules) {
    localModel.value.rules.splice(index, 1);
    emitUpdate();
  }
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
input, .type-select {
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
input:focus, .type-select:focus {
  border-color: #4a9eff;
}
.rules-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid #333;
}
.rule-card {
  background: #222;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rule-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: #888;
  font-weight: bold;
}
.btn-delete {
  background: transparent;
  border: none;
  color: #ff4444;
  font-size: 14px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.btn-delete:hover {
  color: #ff6666;
}
.btn-add-rule {
  padding: 4px 8px;
  background: #333;
  color: #e0e0e0;
  border: 1px dashed #555;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  margin-top: 2px;
}
.btn-add-rule:hover {
  background: #444;
  border-color: #4a9eff;
}
</style>