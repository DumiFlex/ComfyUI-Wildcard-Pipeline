<script setup lang="ts">
import Button from "../../components/ui/Button.vue";
import { useToast } from "../../composables/useToast";

const toast = useToast();
function pushToast(kind: "success" | "warn"): void {
  if (kind === "success") {
    toast.push({ severity: "success", summary: "Saved Hair colour", action: { label: "Undo", run: () => undefined } });
  } else {
    toast.push({ severity: "warn", summary: "Mood fits weather", detail: "Its source wildcard is missing." });
  }
}
</script>

<template>
  <Button @click="pushToast('success')">Show a saved note</Button>
  <Button @click="pushToast('warn')">Show a warning</Button>
</template>
