<script setup lang="ts">
import { ref } from "vue";
import Field from "../../components/ui/Field.vue";
import Input from "../../components/ui/Input.vue";

const name = ref("Hair colour");
</script>

<template>
  <div class="wp-kit__stack">
    <Field label="Name" hint="Shown in the library and on the node." for="kit-field-name">
      <Input id="kit-field-name" v-model="name" />
    </Field>
    <Field label="Writes" error="$subject isn't set by anything upstream." for="kit-field-var">
      <Input id="kit-field-var" model-value="subject" prefix="$" error />
    </Field>
  </div>
</template>
