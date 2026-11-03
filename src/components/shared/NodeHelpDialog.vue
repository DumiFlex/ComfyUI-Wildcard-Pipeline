<script setup lang="ts">
/**
 * The node help dialog: the "?" in ComfyUI's selection toolbar opens the
 * selected WP node's page of the manager docs here, over the canvas
 * (`extension/node-toolbar.ts`). The docs run in a frame (`?frame=help`,
 * the manager's `FrameLayout`: docs only, with their own nav and search),
 * so the canvas bundle never carries the docs.
 *
 * One body-level app, mounted by `main.ts` the first time help opens.
 */
import { computed, ref, watch } from "vue";
import Modal from "@/kit/Modal.vue";
import Button from "@/kit/Button.vue";
import LoadingMark from "@/kit/LoadingMark.vue";
import { helpTarget } from "../../extension/node-toolbar";

const open = computed({
  get: () => helpTarget.value !== null,
  set: (v: boolean) => {
    if (!v) helpTarget.value = null;
  },
});
const title = computed(() => (helpTarget.value ? `Help: ${helpTarget.value.title}` : "Help"));
const src = computed(() => (helpTarget.value ? `/wp/docs/${encodeURIComponent(helpTarget.value.page)}?frame=help` : ""));
const loading = ref(true);
const frame = ref<HTMLIFrameElement | null>(null);

watch(src, (next, prev) => {
  if (next && next !== prev) loading.value = true;
});

/** Keys typed in the frame stay in the frame, so Escape there closes the
 *  dialog by hand (same origin, so its window is ours to listen on). */
function onFrameKey(ev: KeyboardEvent): void {
  if (ev.key === "Escape" && !ev.defaultPrevented) open.value = false;
}

function onLoad(): void {
  loading.value = false;
  const win = frame.value?.contentWindow;
  if (!win) return;
  try {
    win.removeEventListener("keydown", onFrameKey);
    win.addEventListener("keydown", onFrameKey);
  } catch {
    // A frame we can't reach (another origin): Escape outside it still works.
  }
}

/** The page the reader is on now (they may have moved inside the frame). */
function currentPath(): string {
  try {
    const loc = frame.value?.contentWindow?.location;
    if (loc && loc.pathname.startsWith("/wp/")) return `${loc.pathname}${loc.hash}`;
  } catch {
    // Fall back to the page we opened.
  }
  return helpTarget.value ? `/wp/docs/${encodeURIComponent(helpTarget.value.page)}` : "/wp/docs";
}

function openInManager(): void {
  window.open(`${window.location.origin}${currentPath()}`, "_blank", "noopener");
}
</script>

<template>
  <Modal v-model:open="open" :title="title" size="lg">
    <div class="wp-nhelp" data-test="node-help">
      <LoadingMark v-if="loading" class="wp-nhelp__loading" block label="Loading help" />
      <iframe
        v-if="src"
        ref="frame"
        :key="src"
        class="wp-nhelp__frame"
        :class="{ 'is-loading': loading }"
        :src="src"
        :title="title"
        data-test="node-help-frame"
        @load="onLoad"
      />
    </div>
    <template #footer>
      <span class="wp-nhelp__hint">Wildcard Pipeline docs</span>
      <Button variant="secondary" size="sm" icon="external-link" data-test="node-help-open" @click="openInManager">Open in manager</Button>
    </template>
  </Modal>
</template>

<style scoped>
.wp-nhelp {
  position: relative;
  height: min(760px, calc(100vh - 170px));
  min-height: 320px;
}
.wp-nhelp__frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg);
}
.wp-nhelp__frame.is-loading { visibility: hidden; }
.wp-nhelp__loading {
  position: absolute;
  inset: 0;
}
.wp-nhelp__hint {
  margin-right: auto;
  color: var(--wp-text-dim);
  font-size: var(--wp-text-xs);
}
/* The docs need more room than a form dialog: widen this one Modal. */
:global(.wp-modal:has(.wp-nhelp)) { max-width: min(1120px, calc(100vw - 48px)); }
:global(.wp-modal:has(.wp-nhelp) .wp-modal__body) { padding: 0; }
</style>
