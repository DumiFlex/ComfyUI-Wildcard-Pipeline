<script setup lang="ts">
/**
 * Text field. Number fields use WpNumber (`WpNumber.vue`)
 * and search boxes use SearchInput; this one no longer has a number mode.
 */
import { computed } from "vue";
import Icon from "./Icon.vue";

interface Props {
  modelValue: string;
  type?: "text" | "email" | "url" | "password" | "tel";
  placeholder?: string;
  disabled?: boolean;
  /** Shown but not editable: dimmer fill, no focus ring, a lock icon. */
  readonly?: boolean;
  error?: boolean;
  /** Height on the control scale: sm 24 / md 32 / lg 40. */
  size?: "sm" | "md" | "lg";
  /** Icon before the text (a search glass). Drawn inline, no box. */
  icon?: string;
  /** Text before the value, e.g. `$` for a variable name. */
  prefix?: string;
  /** Text after the value, e.g. a unit. */
  suffix?: string;
  id?: string;
  ariaLabel?: string;
}
const props = withDefaults(defineProps<Props>(), {
  type: "text",
  size: "md",
});

const emit = defineEmits<{
  (e: "update:modelValue", v: string): void;
  (e: "blur", evt: FocusEvent): void;
  (e: "focus", evt: FocusEvent): void;
}>();

const inputClasses = computed(() => [
  "wp-input",
  props.size === "sm" && "wp-input--sm",
  props.size === "lg" && "wp-input--lg",
]);

const wrapped = computed(() => Boolean(props.icon || props.prefix || props.suffix || props.readonly));
const groupClasses = computed(() => [
  "wp-input-group",
  props.size === "sm" && "wp-input-group--sm",
  props.size === "lg" && "wp-input-group--lg",
  props.readonly && "wp-input-group--readonly",
  props.disabled && "wp-input-group--disabled",
]);

function onInput(e: Event) {
  emit("update:modelValue", (e.target as HTMLInputElement).value);
}
</script>

<template>
  <div v-if="wrapped" :class="groupClasses" :aria-invalid="error || undefined">
    <span v-if="icon" class="wp-input-group__icon" aria-hidden="true">
      <Icon :name="icon" />
    </span>
    <span v-if="prefix" class="wp-input-group__affix wp-input-group__affix--prefix" aria-hidden="true">{{ prefix }}</span>
    <input
      :id="id"
      :class="inputClasses"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      :aria-label="ariaLabel"
      :aria-invalid="error || undefined"
      @input="onInput"
      @blur="(e) => emit('blur', e)"
      @focus="(e) => emit('focus', e)"
    />
    <span v-if="suffix" class="wp-input-group__affix wp-input-group__affix--suffix" aria-hidden="true">{{ suffix }}</span>
    <span v-if="readonly" class="wp-input-group__lock" aria-hidden="true">
      <Icon name="pi-lock" :size="11" />
    </span>
  </div>
  <input
    v-else
    :id="id"
    :class="inputClasses"
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    :aria-label="ariaLabel"
    :aria-invalid="error || undefined"
    @input="onInput"
    @blur="(e) => emit('blur', e)"
    @focus="(e) => emit('focus', e)"
  />
</template>
