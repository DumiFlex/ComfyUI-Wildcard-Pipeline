<script setup lang="ts">
/**
 * Update-available dialog. Opened from the topbar update pill. Shows the
 * current → latest version, a rendered changelog, and drives the update
 * through ComfyUI Manager (Update Now → installing → staged → explicit
 * Restart). Falls back to guidance when Manager is absent or blocks the
 * call (403). Reboot is always a separate, explicit user click.
 */
import { computed, ref, watch } from "vue";

import Modal from "./ui/Modal.vue";
import Button from "./ui/Button.vue";
import { useReleaseCheck } from "../composables/useReleaseCheck";
import { useComfyManagerUpdate, type ManagerAvailability } from "../composables/useComfyManagerUpdate";
import { renderReleaseNotes } from "../utils/releaseNotes";
import { GITHUB_REPO } from "../config/links";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const { current, latestVersion, severity, releaseBody, releaseUrl } = useReleaseCheck();
const { phase, errorKind, runUpdate, reboot, probe, managerUiUrl } = useComfyManagerUpdate();

const availability = ref<ManagerAvailability | null>(null);

// Probe Manager once each time the dialog opens so we know whether to
// show Update Now or the guidance fallback.
watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen && availability.value === null) {
      availability.value = await probe();
    }
  },
  { immediate: true },
);

const notesHtml = computed(() => renderReleaseNotes(releaseBody.value ?? ""));
const fullChangelogUrl = computed(() => releaseUrl.value ?? `${GITHUB_REPO}/releases`);

const severityLabel = computed(() =>
  severity.value === "major" ? "Major update"
  : severity.value === "minor" ? "Minor update"
  : "Patch update",
);
const severityClass = computed(() =>
  severity.value === "major" ? "wpc-upd__badge--warn" : "wpc-upd__badge--accent",
);

// Fallback whenever Manager is missing OR the update errored with a
// forbidden/failed kind.
const showFallback = computed(
  () => availability.value === "absent" || phase.value === "error",
);

function onClose(): void { emit("close"); }
function onModalOpen(v: boolean): void { if (!v) onClose(); }

/** Kick off the update to the exact version the check found. Passing the
 *  concrete target (not "latest") lets the composable pin it + guard against
 *  a downgrade. */
function onUpdateNow(): void {
  if (latestVersion.value) runUpdate(latestVersion.value);
}
</script>

<template>
  <Modal
    :open="open"
    title="Update available"
    size="md"
    :close-on-backdrop="phase !== 'installing'"
    @update:open="onModalOpen"
  >
    <div class="wpc-upd">
      <div class="wpc-upd__head">
        <span class="wpc-upd__ver">v{{ current }}</span>
        <span class="wpc-upd__arrow" aria-hidden="true">→</span>
        <span class="wpc-upd__ver wpc-upd__ver--new">v{{ latestVersion }}</span>
        <span class="wpc-upd__badge" :class="severityClass">{{ severityLabel }}</span>
      </div>

      <!-- Rendered release notes. `notesHtml` is produced by
           renderReleaseNotes, which escapes before transforming, so this
           is the one sanctioned v-html. -->
      <div class="wpc-relnotes" data-test="update-notes" v-html="notesHtml" />

      <a
        class="wpc-upd__full"
        :href="fullChangelogUrl"
        target="_blank"
        rel="noopener"
        data-test="update-full-changelog"
      >Full changelog →</a>

      <!-- Guidance fallback: Manager missing or blocked. -->
      <div v-if="showFallback" class="wpc-upd__fallback" data-test="update-fallback">
        <p class="wpc-upd__fallback-title">Update via ComfyUI Manager</p>
        <p class="wpc-upd__fallback-body">
          {{ errorKind === "forbidden"
            ? "ComfyUI Manager blocked the in-app update (its security level). Update it from the Manager UI, or pull manually:"
            : "Automatic update isn't available here. Update from the ComfyUI Manager UI, or pull manually:" }}
        </p>
        <a class="wpc-upd__manager-link" :href="managerUiUrl" target="_blank" rel="noopener">Open ComfyUI Manager</a>
        <pre class="wpc-upd__cmd"><code>cd custom_nodes/ComfyUI-Wildcard-Pipeline
git pull
# then restart ComfyUI</code></pre>
      </div>

      <p v-else-if="phase === 'staged'" class="wpc-upd__staged" data-test="update-staged">
        Update staged. Restart ComfyUI to apply.
      </p>
      <p v-else-if="phase === 'restarting'" class="wpc-upd__staged" data-test="update-restarting">
        Restarting ComfyUI… reopen the browser tab in a moment.
      </p>
    </div>

    <template #footer>
      <template v-if="showFallback">
        <Button variant="secondary" data-test="update-later" @click="onClose">Close</Button>
      </template>
      <template v-else-if="phase === 'idle'">
        <Button variant="secondary" data-test="update-later" @click="onClose">Later</Button>
        <Button variant="primary" data-test="update-now" @click="onUpdateNow">Update Now</Button>
      </template>
      <template v-else-if="phase === 'installing'">
        <Button variant="primary" :loading="true" :disabled="true" data-test="update-installing">Updating…</Button>
      </template>
      <template v-else-if="phase === 'staged'">
        <Button variant="secondary" data-test="update-later" @click="onClose">Later</Button>
        <Button variant="primary" data-test="update-restart" @click="reboot">Restart ComfyUI</Button>
      </template>
      <template v-else-if="phase === 'restarting'">
        <Button variant="secondary" data-test="update-later" @click="onClose">Close</Button>
      </template>
    </template>
  </Modal>
</template>

<style scoped>
.wpc-upd { display: flex; flex-direction: column; gap: var(--wp-space-4); }
.wpc-upd__head { display: flex; align-items: center; gap: var(--wp-space-3); flex-wrap: wrap; }
.wpc-upd__ver { font: 600 var(--wp-text-sm)/1 var(--wp-font-mono, monospace); color: var(--wp-text-muted); }
.wpc-upd__ver--new { color: var(--wp-accent-text); }
.wpc-upd__arrow { color: var(--wp-text-dim); }
.wpc-upd__badge { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; padding: 2px 7px; border-radius: 999px; }
.wpc-upd__badge--accent { color: var(--wp-accent-text); background: color-mix(in oklab, var(--wp-accent-500) 18%, transparent); }
.wpc-upd__badge--warn { color: var(--wp-warn, #f59e0b); background: color-mix(in oklab, var(--wp-warn, #f59e0b) 18%, transparent); }
.wpc-relnotes { max-height: 320px; overflow-y: auto; font-size: var(--wp-text-sm); line-height: 1.55; color: var(--wp-text-muted); background: var(--wp-bg-2); border: 1px solid var(--wp-border); border-radius: var(--wp-radius); padding: var(--wp-space-4); }
.wpc-relnotes :deep(h1), .wpc-relnotes :deep(h2), .wpc-relnotes :deep(h3) { color: var(--wp-text); margin: var(--wp-space-3) 0 var(--wp-space-2); font-size: var(--wp-text-sm); font-weight: 700; }
.wpc-relnotes :deep(ul) { margin: var(--wp-space-2) 0; padding-left: var(--wp-space-6); }
.wpc-relnotes :deep(li) { margin: 2px 0; }
.wpc-relnotes :deep(code) { font-family: var(--wp-font-mono, monospace); background: var(--wp-bg-1); padding: 1px 4px; border-radius: 3px; }
.wpc-relnotes :deep(pre) { background: var(--wp-bg-1); padding: var(--wp-space-3); border-radius: var(--wp-radius); overflow-x: auto; }
.wpc-relnotes :deep(a) { color: var(--wp-accent-text); }
.wpc-upd__full { font-size: var(--wp-text-sm); color: var(--wp-accent-text); text-decoration: none; }
.wpc-upd__full:hover { color: var(--wp-text); }
.wpc-upd__fallback { border: 1px solid var(--wp-border); border-radius: var(--wp-radius); padding: var(--wp-space-4); display: flex; flex-direction: column; gap: var(--wp-space-3); }
.wpc-upd__fallback-title { font-weight: 700; color: var(--wp-text); margin: 0; }
.wpc-upd__fallback-body { font-size: var(--wp-text-sm); color: var(--wp-text-muted); margin: 0; }
.wpc-upd__manager-link { font-size: var(--wp-text-sm); color: var(--wp-accent-text); text-decoration: none; }
.wpc-upd__cmd { background: var(--wp-bg-1); border: 1px solid var(--wp-border); border-radius: var(--wp-radius); padding: var(--wp-space-3); font-size: var(--wp-text-sm); overflow-x: auto; margin: 0; }
.wpc-upd__staged { font-size: var(--wp-text-sm); color: var(--wp-accent-text); margin: 0; }
</style>
