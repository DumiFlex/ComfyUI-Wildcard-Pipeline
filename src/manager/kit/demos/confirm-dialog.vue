<script setup lang="ts">
import { ref } from "vue";
import Button from "../../components/ui/Button.vue";
import ConfirmDialog from "@/components/shared/ConfirmDialog.vue";

const confirmOpen = ref(false);
</script>

<template>
  <Button variant="danger" icon="pi-trash" @click="confirmOpen = true">Delete Hair colour</Button>
  <ConfirmDialog
    :visible="confirmOpen"
    title="Delete Hair colour?"
    body="Nodes that use it lose it. You can undo this from the toast."
    confirm-label="Delete"
    variant="danger"
    @confirm="confirmOpen = false"
    @cancel="confirmOpen = false"
  />
</template>
