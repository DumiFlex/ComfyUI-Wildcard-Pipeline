<script setup lang="ts">
import { ref } from "vue";
import Button from "../../../kit/Button.vue";
import Field from "../../../kit/Field.vue";
import Input from "../../../kit/Input.vue";
import Modal from "../../../kit/Modal.vue";

const name = ref("Hair colour");
const modalOpen = ref(false);
</script>

<template>
  <Button @click="modalOpen = true">Open a dialog</Button>
  <Modal v-model:open="modalOpen" title="Rename Hair colour" size="sm">
    <Field label="Name" for="kit-modal-name"><Input id="kit-modal-name" v-model="name" /></Field>
    <template #footer>
      <Button @click="modalOpen = false">Cancel</Button>
      <Button variant="primary" @click="modalOpen = false">Rename</Button>
    </template>
  </Modal>
</template>
