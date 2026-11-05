<script setup lang="ts">
import { ref } from "vue";
import RichTextInput from "../../components/RichTextInput.vue";

const template = ref("$mood portrait of $subject, {soft|warm} light, <lora:film_grain:0.6>, #portrait");
</script>

<template>
  <div class="wp-kit__stack wp-kit__stack--wide">
    <RichTextInput
      v-model="template"
      surface="assembler"
      multiline
      :rows="2"
      :var-suggestions="['mood', 'subject', 'hair']"
      aria-label="Template"
    />
  </div>
</template>
