<script setup lang="ts">
/**
 * The banner on top of a module's window inside a Context Loop.
 *
 * - A frame picked in the Loop's Edit frame: "Editing frame #k", amber, with
 *   Revert #k to base.
 * - Base: when frames override this module, a calm note naming them
 *   ("#2 off · #4 2 changes"), so a base edit that seems to do nothing on
 *   those frames is explained. Nothing shows on Base without overrides.
 */
import { computed } from "vue";
import Button from "@/kit/Button.vue";
import { vTooltip } from "@/kit/tooltip";
import type { ModuleEntry } from "../../widgets/_shared";
import { frameOverrideSummary, type FrameOverrideSummary } from "./frame-overrides";

const props = defineProps<{
  module: ModuleEntry | null;
  /** 0-based frame picked in the Loop's Edit frame; null = Base. */
  currentFrame?: number | null | undefined;
}>();
const emit = defineEmits<{ "revert-frame": [] }>();

const overrides = computed<FrameOverrideSummary[]>(() =>
  props.currentFrame == null && props.module ? frameOverrideSummary(props.module) : [],
);

function chipText(s: FrameOverrideSummary): string {
  const parts: string[] = [];
  if (s.enabled) parts.push(s.enabled);
  if (s.changes) parts.push(`${s.changes} change${s.changes === 1 ? "" : "s"}`);
  return `#${s.frame + 1}${parts.length ? ` ${parts.join(", ")}` : ""}`;
}
function chipHint(s: FrameOverrideSummary): string {
  const lines: string[] = [];
  if (s.enabled === "off") lines.push(`Frame ${s.frame + 1} switches this module off.`);
  if (s.enabled === "on") lines.push(`Frame ${s.frame + 1} switches this module on.`);
  if (s.changes) lines.push(`Frame ${s.frame + 1} overrides ${s.changes} setting${s.changes === 1 ? "" : "s"}; base edits to ${s.changes === 1 ? "it" : "them"} don't reach this frame.`);
  lines.push("Pick the frame in the Context Loop's Edit frame to change it.");
  return lines.join("\n");
}
const summary = computed(() => {
  const n = overrides.value.length;
  return n === 1 ? "Frame overrides this module:" : `${n} frames override this module:`;
});
</script>

<template>
  <div v-if="currentFrame != null" class="wp-modal-frame-banner" data-test="modal-frame-banner">
    <span>Editing frame #{{ currentFrame + 1 }} — changes affect only this frame.</span>
    <Button size="sm" variant="outline" icon="pi-replay" data-test="modal-frame-revert" @click="emit('revert-frame')">Revert #{{ currentFrame + 1 }} to base</Button>
  </div>
  <div v-else-if="overrides.length" class="wp-modal-frame-banner is-base" data-test="modal-base-frames">
    <i class="pi pi-clone wp-modal-frame-banner__icon" aria-hidden="true" />
    <span class="wp-modal-frame-banner__text">
      Editing base. {{ summary }}
      <span
        v-for="s in overrides"
        :key="s.frame"
        v-tooltip="chipHint(s)"
        class="wp-modal-frame-banner__chip"
        :data-test="`modal-base-frame-${s.frame}`"
      >{{ chipText(s) }}</span>
    </span>
  </div>
</template>

<style scoped>
.wp-modal-frame-banner {
  display: flex;
  gap: 10px;
  margin: 10px 14px 0;
  align-items: center;
  justify-content: space-between;
  padding: 7px 11px;
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  /* solid surface (amber mixed into the modal bg, not over the canvas) so the
   * text stays readable; amber = the override/warning accent used elsewhere. */
  background: color-mix(in oklab, var(--wp-amber) 14%, var(--wp-bg2));
  border: 1px solid color-mix(in oklab, var(--wp-amber) 38%, transparent);
  color: var(--wp-amber);
  font: 500 11px var(--wp-font-sans);
}
.wp-modal-frame-banner :deep(.wp-btn) {
  flex-shrink: 0;
  border-color: color-mix(in oklab, var(--wp-amber) 55%, transparent);
  color: var(--wp-amber);
}
/* Base: a calmer note in the accent, since nothing is wrong. */
.wp-modal-frame-banner.is-base {
  justify-content: flex-start;
  gap: 8px;
  background: color-mix(in oklab, var(--wp-accent) 10%, var(--wp-bg2));
  border-color: color-mix(in oklab, var(--wp-accent) 32%, transparent);
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-modal-frame-banner__icon { flex: none; color: var(--wp-accent); font-size: 12px; }
.wp-modal-frame-banner__text { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-width: 0; }
.wp-modal-frame-banner__chip {
  padding: 1px 6px;
  border-radius: min(3px, var(--wp-radius-cap, 999px));
  background: color-mix(in oklab, var(--wp-amber) 16%, transparent);
  color: var(--wp-amber);
  font: 600 10.5px var(--wp-font-mono, monospace);
  cursor: help;
}
</style>
