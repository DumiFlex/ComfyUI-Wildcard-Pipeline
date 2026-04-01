<template>
  <div class="assembler-widget">
    <div class="field">
      <label>Template</label>
      <textarea
        v-model="localTemplate"
        @input="emitUpdate"
        placeholder="e.g. $character in $environment, $lighting atmosphere"
        rows="3"
      ></textarea>
    </div>
    <div v-if="variables.length" class="variables-section">
      <label>Variables</label>
      <div class="variable-chips">
        <button
          v-for="v in variables"
          :key="v"
          class="chip"
          @click="insertVariable(v)"
          :title="`Insert $${v}`"
        >
          ${{ v }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const localTemplate = ref(props.modelValue || "");

watch(
  () => props.modelValue,
  (v) => {
    localTemplate.value = v || "";
  }
);

const variables = computed(() => {
  const matches = localTemplate.value.match(/\$(\w+)/g);
  if (!matches) return [];
  const unique = new Set(
    matches.map((m) => m.slice(1)).filter((v) => !v.startsWith("__"))
  );
  return [...unique];
});

const emitUpdate = () => {
  emit("update:modelValue", localTemplate.value);
};

const insertVariable = (name: string) => {
  localTemplate.value += `$${name}`;
  emitUpdate();
};
</script>

<style scoped>
.assembler-widget {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  font-family: sans-serif;
  font-size: 12px;
  color: #e0e0e0;
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
textarea {
  width: 100%;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid #444;
  background: #2a2a2a;
  color: #e0e0e0;
  font-size: 12px;
  box-sizing: border-box;
  outline: none;
  font-family: monospace;
  resize: vertical;
  min-height: 50px;
}
textarea:focus {
  border-color: #4a9eff;
}
.variables-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.variable-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.chip {
  padding: 2px 8px;
  background: #2a2a2a;
  border: 1px solid #555;
  border-radius: 12px;
  color: #4a9eff;
  font-size: 11px;
  cursor: pointer;
  font-family: monospace;
}
.chip:hover {
  background: #333;
  border-color: #4a9eff;
}
</style>
