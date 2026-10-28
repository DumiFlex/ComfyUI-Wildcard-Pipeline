<script setup lang="ts">
/**
 * Drop zone: where files go, by dragging them in or with Browse. It lights
 * up when a file it takes is dragged over, turns red with the reason when
 * it won't take it, and says what it takes. Works on the canvas and in the
 * manager.
 *
 *   <DropZone accept=".txt,.yaml,.yml,.zip" multiple hint="Wildcard files or a zip" @files="load" />
 *   <DropZone overlay accept="image/*" label="Drop images to attach" @files="attach"><ChatThread /></DropZone>
 *
 * `overlay` wraps content (a chat, a panel) and only shows while a file is
 * dragged over it. Files the zone can't take (wrong type, over `max-size`,
 * more than one without `multiple`) come back on `reject` with a reason,
 * and the rest on `files`. Browse keeps it usable without a mouse.
 */
import { computed, ref } from "vue";
import { dragItemMaybeAccepted, fileAccepted, formatBytes } from "./drop-zone";
import WpButton from "./WpButton.vue";

export interface RejectedFile { file: File; reason: string }

const props = withDefaults(defineProps<{
  /** Like the file input's accept: "image/*,.txt". Empty takes anything. */
  accept?: string;
  multiple?: boolean;
  /** Largest file in bytes. */
  maxSize?: number;
  disabled?: boolean;
  /** Wrap the slot and show only while a file is dragged over it. */
  overlay?: boolean;
  /** The main line. */
  label?: string;
  /** The line under it, e.g. what it takes. */
  hint?: string;
  /** Words for the Browse button. */
  browseLabel?: string;
  size?: "sm" | "md";
}>(), {
  accept: undefined, maxSize: undefined, label: undefined, hint: undefined,
  browseLabel: "Browse", size: "md",
});

const emit = defineEmits<{ (e: "files", files: File[]): void; (e: "reject", files: RejectedFile[]): void }>();

const inputEl = ref<HTMLInputElement | null>(null);
const over = ref<"none" | "ok" | "refuse">("none");
const refuseWhy = ref("");
let depth = 0;

const mainLabel = computed(() => props.label ?? (props.multiple ? "Drop files here" : "Drop a file here"));

function hasFiles(ev: DragEvent): boolean {
  return !!ev.dataTransfer && [...ev.dataTransfer.types].includes("Files");
}

function judge(ev: DragEvent): void {
  const items = [...(ev.dataTransfer?.items ?? [])].filter((i) => i.kind === "file");
  if (!props.multiple && items.length > 1) { over.value = "refuse"; refuseWhy.value = "One file at a time"; return; }
  if (items.some((i) => !dragItemMaybeAccepted(i.type, props.accept))) {
    over.value = "refuse";
    refuseWhy.value = props.hint ? `Only ${props.hint}` : "This kind of file isn't taken here";
    return;
  }
  over.value = "ok";
}

function onDragEnter(ev: DragEvent): void {
  if (props.disabled || !hasFiles(ev)) return;
  ev.preventDefault();
  depth++;
  judge(ev);
}

function onDragOver(ev: DragEvent): void {
  if (props.disabled || !hasFiles(ev)) return;
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = over.value === "refuse" ? "none" : "copy";
}

function onDragLeave(ev: DragEvent): void {
  if (props.disabled || !hasFiles(ev)) return;
  depth = Math.max(0, depth - 1);
  if (!depth) over.value = "none";
}

function take(list: File[]): void {
  const ok: File[] = [];
  const bad: RejectedFile[] = [];
  for (const f of list) {
    if (!fileAccepted(f, props.accept)) bad.push({ file: f, reason: "Not a file this takes" });
    else if (props.maxSize !== undefined && f.size > props.maxSize) bad.push({ file: f, reason: `Over ${formatBytes(props.maxSize)}` });
    else if (!props.multiple && ok.length) bad.push({ file: f, reason: "One file at a time" });
    else ok.push(f);
  }
  if (ok.length) emit("files", ok);
  if (bad.length) emit("reject", bad);
}

function onDrop(ev: DragEvent): void {
  if (props.disabled || !hasFiles(ev)) return;
  ev.preventDefault();
  depth = 0;
  over.value = "none";
  take([...(ev.dataTransfer?.files ?? [])]);
}

function browse(): void {
  if (!props.disabled) inputEl.value?.click();
}

function onPicked(ev: Event): void {
  const el = ev.target as HTMLInputElement;
  take([...(el.files ?? [])]);
  el.value = "";
}

defineExpose({ browse });
</script>

<!-- A drop target: Browse is the keyboard and screen reader way in. -->
<!-- eslint-disable vuejs-accessibility/no-static-element-interactions -->
<template>
  <div
    v-if="overlay"
    class="wp-drop-wrap"
    :data-over="over === 'none' ? undefined : over"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <slot />
    <div v-if="over !== 'none'" class="wp-drop wp-drop--overlay" :data-over="over" :data-size="size" aria-hidden="true">
      <i class="pi wp-drop__icon" :class="over === 'refuse' ? 'pi-ban' : 'pi-upload'" />
      <span class="wp-drop__label">{{ over === "refuse" ? refuseWhy : mainLabel }}</span>
    </div>
    <input ref="inputEl" class="wp-drop__input" type="file" :accept="accept" :multiple="multiple" tabindex="-1" aria-hidden="true" @change="onPicked">
  </div>
  <div
    v-else
    class="wp-drop"
    :data-over="over === 'none' ? undefined : over"
    :data-size="size"
    :data-disabled="disabled || undefined"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <i class="pi wp-drop__icon" :class="over === 'refuse' ? 'pi-ban' : 'pi-upload'" aria-hidden="true" />
    <span class="wp-drop__text">
      <span class="wp-drop__label">{{ over === "refuse" ? refuseWhy : mainLabel }}</span>
      <span v-if="hint && over !== 'refuse'" class="wp-drop__hint">{{ hint }}{{ maxSize ? ` · up to ${formatBytes(maxSize)}` : "" }}</span>
    </span>
    <WpButton class="wp-drop__browse" variant="secondary" size="sm" icon="pi-folder-open" :disabled="disabled" @click="browse">{{ browseLabel }}</WpButton>
    <input ref="inputEl" class="wp-drop__input" type="file" :accept="accept" :multiple="multiple" tabindex="-1" aria-hidden="true" @change="onPicked">
  </div>
</template>

<style scoped>
.wp-drop {
  --_tone: var(--wp-border-strong);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--wp-space-3);
  box-sizing: border-box; min-width: 0; padding: var(--wp-space-7) var(--wp-space-5);
  border: 1.5px dashed var(--_tone); border-radius: var(--wp-radius-md);
  background: var(--wp-bg-1); color: var(--wp-text-muted); text-align: center;
  font: 400 var(--wp-text-sm)/1.4 var(--wp-font-sans);
  transition: border-color var(--wp-motion-hover), background var(--wp-motion-hover);
}
.wp-drop[data-size="sm"] {
  flex-direction: row; justify-content: flex-start; gap: var(--wp-space-4); text-align: left;
  padding: var(--wp-space-3) var(--wp-space-4); border-radius: var(--wp-radius); font-size: var(--wp-text-xs);
}
.wp-drop[data-over="ok"] { --_tone: var(--wp-accent); background: color-mix(in srgb, var(--wp-accent) 8%, var(--wp-bg-1)); color: var(--wp-text); }
.wp-drop[data-over="refuse"] { --_tone: var(--wp-danger); background: color-mix(in srgb, var(--wp-danger) 8%, var(--wp-bg-1)); color: var(--wp-danger-text); }
.wp-drop[data-disabled] { opacity: 0.45; }
.wp-drop__icon { font-size: 20px; color: var(--_tone); }
.wp-drop[data-over="ok"] .wp-drop__icon { color: var(--wp-accent-text); }
.wp-drop[data-size="sm"] .wp-drop__icon { font-size: 14px; }
.wp-drop__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wp-drop[data-size="sm"] .wp-drop__text { flex: 1; }
.wp-drop__label { color: inherit; font-weight: 500; }
.wp-drop:not([data-over]) .wp-drop__label { color: var(--wp-text); }
.wp-drop__hint { color: var(--wp-text-dim); font-size: var(--wp-text-xs); }
.wp-drop__browse { flex: none; }
.wp-drop__input { display: none; }
.wp-drop-wrap { position: relative; min-width: 0; min-height: 0; }
.wp-drop--overlay {
  position: absolute; inset: var(--wp-space-2); z-index: 5; pointer-events: none;
  background: color-mix(in srgb, var(--wp-bg) 82%, transparent); backdrop-filter: blur(2px);
}
.wp-drop--overlay[data-over="ok"] { background: color-mix(in srgb, var(--wp-accent) 12%, var(--wp-bg)); }
@media (prefers-reduced-motion: reduce) {
  .wp-drop { transition: none; }
}
</style>
