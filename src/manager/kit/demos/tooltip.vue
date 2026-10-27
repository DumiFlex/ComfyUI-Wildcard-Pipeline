<script setup lang="ts">
import Button from "../../components/ui/Button.vue";
import { vTooltip } from "@/components/shared/tooltip";
</script>

<template>
  <Button v-tooltip="{ text: 'Copy to clipboard', kbd: 'Ctrl C' }" variant="ghost" icon="pi-copy" aria-label="Copy" />
  <Button v-tooltip="{ text: 'Runs before the Assembler reads it', placement: 'right' }">Hover or Tab here</Button>
  <span v-tooltip="'Edited 5 minutes ago by you'" class="wp-kit__inline" tabindex="0">Plain text works too</span>
</template>
