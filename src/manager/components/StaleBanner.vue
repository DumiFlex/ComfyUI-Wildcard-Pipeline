<script setup lang="ts">
/**
 * Sticky banner shown at the top of the SPA when the backend's
 * X-WP-Startup-Id has changed since the page loaded — i.e. ComfyUI
 * restarted. Reload button refreshes the page.
 *
 * Mounted unconditionally in AppLayout. The store flag controls
 * visibility; transition fades it in/out.
 */
import { ref } from "vue";
import Button from "../../kit/Button.vue";
import Banner from "@/kit/Banner.vue";
import ConfirmModal from "../../kit/ConfirmModal.vue";
import { useStaleStore } from "../stores/staleStore";
import { useSystemStore } from "../stores/systemStore";

const stale = useStaleStore();
const system = useSystemStore();

// Restart confirm prompt — kicking ComfyUI's process is destructive
// enough (running workflows + queues get interrupted) that the user
// should explicitly confirm rather than fire on a single click.
const restartConfirmOpen = ref(false);
function askRestart() { restartConfirmOpen.value = true; }
function onRestartConfirmed() {
  restartConfirmOpen.value = false;
  void system.restart();
}
function onRestartCancelled() {
  restartConfirmOpen.value = false;
}
</script>

<template>
  <Transition name="wp-stale-fade">
    <Banner
      v-if="stale.isStale"
      class="wp-stale"
      tone="warn"
      icon="pi-refresh"
      data-test="stale-banner"
    >
      <template v-if="stale.newVersion">
        Wildcard Pipeline was updated to v{{ stale.newVersion }}. Reload to use the new version.
      </template>
      <template v-else>ComfyUI has restarted. This page may be out of date.</template>
      <template #actions>
        <Button
          variant="primary"
          size="sm"
          icon="pi-refresh"
          data-test="stale-reload"
          @click="() => stale.reload()"
        >Reload page</Button>
        <Button
          v-if="system.canRestart"
          variant="secondary"
          size="sm"
          icon="pi-power-off"
          :loading="system.restarting"
          data-test="stale-restart"
          @click="askRestart"
        >Restart ComfyUI</Button>
      </template>
    </Banner>
  </Transition>

  <ConfirmModal
    :open="restartConfirmOpen"
    title="Restart ComfyUI?"
    body="This kicks the running ComfyUI process. Any in-flight workflows and queued prompts will be interrupted. The page will reload automatically once the server is back."
    confirm-label="Restart"
    tone="danger"
    @confirm="onRestartConfirmed"
    @cancel="onRestartCancelled"
  />
</template>

<style scoped>
/* A full-width bar pinned to the top of the page, not a card. */
.wp-stale {
  position: sticky;
  top: 0;
  z-index: 50;
  border-width: 0 0 1px;
  border-radius: 0;
  box-shadow: var(--wp-elev-1);
}

.wp-stale-fade-enter-active,
.wp-stale-fade-leave-active {
  transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
              opacity 180ms ease;
}
.wp-stale-fade-enter-from,
.wp-stale-fade-leave-to {
  transform: translateY(-8px);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .wp-stale-fade-enter-active,
  .wp-stale-fade-leave-active { transition: none; }
}
</style>
