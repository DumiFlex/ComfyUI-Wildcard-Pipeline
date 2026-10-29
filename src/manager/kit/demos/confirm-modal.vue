<script setup lang="ts">
import { ref } from "vue";
import Button from "../../../kit/Button.vue";
import ConfirmModal from "../../../kit/ConfirmModal.vue";

const ask = ref<"delete" | "restore" | null>(null);
</script>

<template>
  <Button variant="danger" icon="pi-trash" @click="ask = 'delete'">Delete Hair colour</Button>
  <Button icon="pi-history" @click="ask = 'restore'">Restore a backup</Button>
  <ConfirmModal
    :open="ask === 'delete'"
    title="Delete Hair colour?"
    body="Nodes that use it lose it. You can undo this from the toast."
    confirm-label="Delete"
    tone="danger"
    @confirm="ask = null"
    @cancel="ask = null"
  />
  <ConfirmModal
    :open="ask === 'restore'"
    title="Restore this backup?"
    body="Your library goes back to how it was on 27 Oct, 14:02."
    confirm-label="Restore"
    @confirm="ask = null"
    @cancel="ask = null"
  />
</template>
