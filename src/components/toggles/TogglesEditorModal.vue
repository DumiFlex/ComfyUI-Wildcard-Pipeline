<script setup lang="ts">
/**
 * TogglesEditorModal — the WP Toggles edit window.
 *
 * Editing inside the node was cramped, so the node keeps only its clean view
 * and the pencil opens this window. It edits a DRAFT: Done writes it back,
 * Cancel or Escape drops it (a click on the backdrop does nothing, so a stray
 * click never loses work). The right column is the node's clean view drawn
 * from the draft, so looks (style, icons, colours) show as they change.
 */
import { ref } from "vue";
import Button from "@/kit/Button.vue";
import ModalShell from "@/kit/ModalShell.vue";
import TogglesWidget from "./TogglesWidget.vue";
import type { TogglesConfig } from "../../extension/toggles";
import type { ControlState } from "../../extension/toggle-control";
import type { VarProducerLike } from "../../manager/components/RefChip.vue";

const props = defineProps<{
  modelValue: TogglesConfig;
  nodeTitle: string;
  controls?: Record<string, ControlState> | undefined;
  canvasGroups?: string[] | undefined;
  upstreamVars?: string[] | undefined;
  varProducers?: Map<string, VarProducerLike> | undefined;
}>();
const emit = defineEmits<{ "update:modelValue": [next: TogglesConfig]; close: [] }>();

// A plain copy: the prop is a reactive proxy, which structuredClone refuses.
const draft = ref<TogglesConfig>(JSON.parse(JSON.stringify(props.modelValue)) as TogglesConfig);

function done(): void {
  emit("update:modelValue", draft.value);
  emit("close");
}
function onClose(reason: "escape" | "backdrop"): void {
  if (reason === "escape") emit("close");
}
</script>

<template>
  <ModalShell :visible="true" label="Edit toggles" @close="onClose">
    <div class="wp-tge" data-test="tg-editor-window">
      <div class="wp-tge__head">
        <span class="wp-tge__head-icon"><i class="pi pi-sliders-h" aria-hidden="true" /></span>
        <div class="wp-tge__title-block">
          <div class="wp-tge__title-row">
            <span class="wp-tge__name">{{ nodeTitle || "WP Toggles" }}</span><span class="wp-tge__chip">Toggles</span>
          </div>
          <div class="wp-tge__sub">Changes apply when you press Done.</div>
        </div>
        <Button variant="ghost" icon="times" aria-label="Close" size="sm" kbd="Esc" data-test="tg-window-close" @click="emit('close')" />
      </div>
      <div class="wp-tge__body">
        <section class="wp-tge__edit" aria-label="Edit">
          <TogglesWidget
            v-model="draft"
            view="editor"
            :controls="controls"
            :canvas-groups="canvasGroups"
            :upstream-vars="upstreamVars"
            :var-producers="varProducers"
          />
        </section>
        <section class="wp-tge__preview" aria-label="Preview">
          <div class="wp-tge__cap">PREVIEW</div>
          <div class="wp-tge__node" data-test="tg-preview">
            <div class="wp-tge__node-title">{{ nodeTitle || "WP Toggles" }}</div>
            <TogglesWidget v-model="draft" view="preview" :controls="controls" />
          </div>
          <p class="wp-tge__hint">Click the preview to try it; what is on when you press Done is saved too.</p>
        </section>
      </div>
      <div class="wp-tge__foot">
        <span class="wp-tge__spacer" />
        <Button size="sm" data-test="tg-window-cancel" @click="emit('close')">Cancel</Button>
        <Button variant="primary" size="sm" icon="pi-check" data-test="tg-window-done" @click="done">Done</Button>
      </div>
    </div>
  </ModalShell>
</template>

<style scoped>
.wp-tge {
  width: 860px;
  max-width: 100%;
  height: min(720px, 88vh);
  display: flex;
  flex-direction: column;
  background: var(--wp-bg2);
  border: 1px solid var(--wp-border);
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  overflow: hidden;
  color: var(--wp-text);
  font: 12px var(--wp-font-sans, sans-serif);
  box-shadow: var(--wp-shadow-lg);
}
.wp-tge__head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; flex-shrink: 0; border-bottom: 1px solid var(--wp-border); background: color-mix(in srgb, var(--wp-accent) 9%, var(--wp-bg2)); }
.wp-tge__head-icon { color: var(--wp-accent); width: 24px; display: flex; justify-content: center; }
.wp-tge__title-block { flex: 1; min-width: 0; }
.wp-tge__title-row { display: flex; align-items: center; gap: 8px; }
.wp-tge__name { font: 600 13px var(--wp-font-sans, sans-serif); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-tge__chip { font: 600 9px var(--wp-font-sans, sans-serif); text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 6px; border-radius: min(2px, var(--wp-radius-cap, 999px)); background: color-mix(in srgb, var(--wp-accent) 22%, transparent); color: var(--wp-accent); }
.wp-tge__sub { font: 10px var(--wp-font-sans, sans-serif); color: var(--wp-text-dim, var(--wp-text3)); margin-top: 3px; }
.wp-tge__body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 300px; }
.wp-tge__edit { overflow-y: auto; padding: 10px 14px; min-width: 0; }
.wp-tge__preview { overflow-y: auto; padding: 10px 14px; border-left: 1px solid var(--wp-border); background: var(--wp-bg-deep, var(--wp-bg)); display: flex; flex-direction: column; gap: 8px; }
.wp-tge__cap { font: 600 9px var(--wp-font-sans, sans-serif); letter-spacing: 0.08em; color: var(--wp-text-dim, var(--wp-text3)); }
/* A plain stand-in for the node's frame, so the preview reads as the node. */
.wp-tge__node { padding: 0 10px 6px; background: var(--wp-bg2); border: 1px solid var(--wp-border); border-radius: min(8px, var(--wp-radius-cap, 999px)); }
.wp-tge__node-title { padding: 6px 0; margin: 0 -10px 4px; padding-left: 10px; font-weight: 600; border-bottom: 1px solid var(--wp-border); color: var(--wp-text-muted, var(--wp-text2)); }
.wp-tge__hint { margin: 0; font-size: 10.5px; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-tge__foot { display: flex; align-items: center; gap: 8px; padding: 10px 14px; flex-shrink: 0; background: var(--wp-bg3); border-top: 1px solid var(--wp-border); }
.wp-tge__spacer { flex: 1; }
@media (max-width: 720px) {
  .wp-tge__body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
  .wp-tge__preview { border-left: 0; border-top: 1px solid var(--wp-border); max-height: 40vh; }
}
</style>
