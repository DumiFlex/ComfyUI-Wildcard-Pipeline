<script setup lang="ts">
/** Corrupt-workflow recovery panel (5.6) for a Context node whose saved
 *  JSON failed to parse. Styles live in `context-widget.css`. */
/** `showRaw` ("View raw") is owned by the widget so it survives the panel
 *  unmounting and coming back. */
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
      <button type="button" class="wp-recovery__btn" @click="$emit('toggleRaw')">
        <i class="pi" :class="showRaw ? 'pi-eye-slash' : 'pi-eye'" aria-hidden="true"></i>
        {{ showRaw ? "Hide raw" : "View raw" }}
      </button>
      <button
        type="button"
        class="wp-recovery__btn wp-recovery__btn--danger"
        @click="$emit('reset')"
      >
        <i class="pi pi-refresh" aria-hidden="true"></i>
        Reset to empty
      </button>
    </div>
    <pre v-if="showRaw" class="wp-recovery__raw">{{ raw }}</pre>
  </div>
</template>
