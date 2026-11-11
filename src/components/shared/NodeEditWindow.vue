<script setup lang="ts">
/**
 * The window a canvas node opens for edits that are too big for the node
 * itself (WP Note's text, WP Toggles' list), laid out like the module edit
 * windows: a header naming the node and what is being edited, the body,
 * and Cancel / Done. The caller keeps a draft and writes it on `done`.
 * Closing with changes (Escape, the backdrop, ×, Cancel) asks first, so a
 * stray Escape never throws away writing.
 */
import { ref } from "vue";
import Button from "@/kit/Button.vue";
import ConfirmModal from "@/kit/ConfirmModal.vue";
import Kbd from "@/kit/Kbd.vue";
import ModalShell from "@/kit/ModalShell.vue";

const props = withDefaults(defineProps<{
  /** The node's title. */
  title: string;
  /** What the window edits, shown as a small chip next to the title. */
  chip: string;
  /** PrimeIcons name for the header, without `pi-`. */
  icon?: string;
  /** One line under the title. */
  sub?: string;
  /** Whether the draft differs from what the node holds. */
  dirty?: boolean;
  /** The window's width in px (it never gets wider than the screen). */
  width?: number;
  /** The text on the footer's left. */
  footHint?: string;
  /** The body has no padding and doesn't scroll: the slot lays itself out
   *  (e.g. two columns that scroll on their own). */
  flush?: boolean;
}>(), { icon: "pencil", sub: "", dirty: false, width: 720, flush: false, footHint: "Changes save with the node when you press Done." });

const emit = defineEmits<{
  (e: "done"): void;
  (e: "cancel"): void;
  /** Every key pressed in the window (the shell keeps them from ComfyUI). */
  (e: "keydown", ev: KeyboardEvent): void;
}>();

const asking = ref(false);
function cancel(): void {
  if (props.dirty) asking.value = true;
  else emit("cancel");
}
function onKey(ev: KeyboardEvent): void {
  if (asking.value) return;
  // Ctrl/Cmd+Enter is Done from anywhere in the window.
  if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    emit("done");
    return;
  }
  emit("keydown", ev);
}
</script>

<template>
  <ModalShell :visible="true" labelledby="wp-node-edit-title" @close="cancel" @keydown="onKey">
    <div class="wp-node-edit" :style="{ width: `${width}px` }" data-test="node-edit-window">
      <header class="wp-node-edit__head">
        <span class="wp-node-edit__icon"><i class="pi" :class="`pi-${icon}`" aria-hidden="true"></i></span>
        <div class="wp-node-edit__titles">
          <div class="wp-node-edit__title-row">
            <span id="wp-node-edit-title" class="wp-node-edit__name">{{ title }}</span>
            <span class="wp-node-edit__chip">{{ chip }}</span>
          </div>
          <div v-if="sub" class="wp-node-edit__sub">{{ sub }}</div>
        </div>
        <Button variant="ghost" icon="times" aria-label="Close" size="sm" kbd="Esc" data-test="node-edit-close" @click="cancel" />
      </header>
      <div class="wp-node-edit__body" :class="{ 'wp-node-edit__body--flush': flush }">
        <slot></slot>
      </div>
      <footer class="wp-node-edit__foot">
        <span class="wp-node-edit__hint"><Kbd keys="Mod+Enter" size="sm" /> Done · {{ footHint }}</span>
        <span class="wp-node-edit__spacer"></span>
        <Button size="sm" data-test="node-edit-cancel" @click="cancel">Cancel</Button>
        <Button size="sm" variant="primary" data-test="node-edit-done" @click="emit('done')">Done</Button>
      </footer>
    </div>
  </ModalShell>
  <ConfirmModal
    :open="asking"
    title="Discard your changes?"
    body="What you changed in this window isn't on the node yet."
    confirm-label="Discard"
    cancel-label="Keep editing"
    tone="warn"
    @confirm="asking = false; emit('cancel')"
    @cancel="asking = false"
  />
</template>

<style scoped>
.wp-node-edit {
  max-width: calc(100vw - 32px);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: min(8px, var(--wp-radius-cap, 999px));
  overflow: hidden;
  color: var(--wp-text);
  font: 12px var(--wp-font-sans, sans-serif);
  box-shadow: var(--wp-shadow-lg, 0 12px 40px rgb(0 0 0 / 0.45));
}
.wp-node-edit__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--wp-border);
  background: color-mix(in srgb, var(--wp-accent) 9%, var(--wp-bg-2));
}
.wp-node-edit__icon { color: var(--wp-accent); width: 24px; display: flex; justify-content: center; }
.wp-node-edit__titles { flex: 1; min-width: 0; }
.wp-node-edit__title-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wp-node-edit__name { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-node-edit__chip {
  flex: none;
  font-weight: 600;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 2px 6px;
  border-radius: min(2px, var(--wp-radius-cap, 999px));
  background: color-mix(in srgb, var(--wp-accent) 22%, transparent);
  color: var(--wp-accent);
}
.wp-node-edit__sub { font-size: 11px; color: var(--wp-text-dim); margin-top: 3px; }
.wp-node-edit__body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 12px 14px; }
.wp-node-edit__body--flush { display: flex; flex-direction: column; overflow: hidden; padding: 0; }
.wp-node-edit__foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  flex-shrink: 0;
  border-top: 1px solid var(--wp-border);
  background: var(--wp-bg-3, var(--wp-bg-2));
}
.wp-node-edit__hint { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--wp-text-dim); }
.wp-node-edit__spacer { flex: 1; }
</style>
