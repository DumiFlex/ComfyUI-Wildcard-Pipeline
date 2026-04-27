<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";

interface Props {
  modelValue: string | number;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  icon?: string;
  addon?: string;
  id?: string;
  ariaLabel?: string;
}
const props = withDefaults(defineProps<Props>(), {
  type: "text",
  size: "md",
});

const emit = defineEmits<{
  (e: "update:modelValue", v: string | number): void;
  (e: "blur", evt: FocusEvent): void;
  (e: "focus", evt: FocusEvent): void;
}>();

const inputClasses = computed(() => [
  "wp-input",
  props.size === "sm" && "wp-input--sm",
]);

const wrapped = computed(() => Boolean(props.icon || props.addon));

function onInput(e: Event) {
  const target = e.target as HTMLInputElement;
  // Coerce numeric inputs back to number for v-model parity.
  if (props.type === "number" && target.value !== "") {
    emit("update:modelValue", Number(target.value));
  } else {
    emit("update:modelValue", target.value);
  }
}
</script>

<template>
  <div v-if="wrapped" class="wp-input-group">
    <span v-if="icon" class="wp-input-group__addon">
      <Icon :name="icon" />
    </span>
    <input
      :id="id"
      :class="inputClasses"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-label="ariaLabel"
      @input="onInput"
      @blur="(e) => emit('blur', e)"
      @focus="(e) => emit('focus', e)"
    />
    <span v-if="addon" class="wp-input-group__addon wp-input-group__addon--right">{{ addon }}</span>
  </div>
  <input
    v-else
    :id="id"
    :class="inputClasses"
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :aria-label="ariaLabel"
    @input="onInput"
    @blur="(e) => emit('blur', e)"
    @focus="(e) => emit('focus', e)"
  />
</template>
