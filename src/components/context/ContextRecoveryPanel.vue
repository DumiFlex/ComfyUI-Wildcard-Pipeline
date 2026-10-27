<script setup lang="ts">
/** Corrupt-workflow recovery panel (5.6) for a Context node whose saved
 *  JSON failed to parse. Styles live in `context-widget.css`. */
/** `showRaw` ("View raw") is owned by the widget so it survives the panel
 *  unmounting and coming back. */
import WpButton from "../shared/WpButton.vue";

defineProps<{ error: string; raw: string; showRaw: boolean }>();
defineEmits<{ reset: []; toggleRaw: [] }>();
</script>

<template>
  <!-- Surfaces when JSON parse fails or returns a non-object. View raw
       exposes the bad payload so users can copy it out before resetting. -->
  <div class="wp-recovery" role="alert">
    <div class="wp-recovery__header">
      <i class="pi pi-exclamation-triangle wp-recovery__icon" aria-hidden="true"></i>
      <div class="wp-recovery__msg">
        <strong>Couldn't read this node's saved data.</strong>
        <div class="wp-recovery__detail">{{ error }}</div>
      </div>
    </div>
    <div class="wp-recovery__actions">
      <WpButton :icon="showRaw ? 'pi-eye-slash' : 'pi-eye'" @click="$emit('toggleRaw')">{{ showRaw ? "Hide raw" : "View raw" }}</WpButton>
      <WpButton variant="danger" icon="pi-refresh" @click="$emit('reset')">Reset to empty</WpButton>
    </div>
    <pre v-if="showRaw" class="wp-recovery__raw">{{ raw }}</pre>
  </div>
</template>
