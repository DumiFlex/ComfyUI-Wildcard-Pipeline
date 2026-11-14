<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import Button from "@/kit/Button.vue";
import NoteMarkdown from "./note-markdown";
import { noteColorCss, type NoteConfig } from "../../extension/note";

/** The hover card of a Label note: its text (with its links and icons) and
 *  an Edit button. Placed above the label (below when there is no room).
 *  Without an anchor it sits in the page with no Edit button: the note text
 *  window's preview of a label. */
const props = defineProps<{
  config: Pick<NoteConfig, "text" | "images" | "color">;
  title: string;
  anchor?: DOMRect | undefined;
}>();

const emit = defineEmits<{ (e: "edit"): void }>();

const card = ref<HTMLElement | null>(null);
const pos = ref({ left: 0, top: 0 });
const GAP = 8;
const EDGE = 8;

function place(): void {
  const el = card.value;
  const a = props.anchor;
  if (!el || !a) return;
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  let top = a.top - hgt - GAP;
  if (top < EDGE) top = a.bottom + GAP;
  const left = Math.max(EDGE, Math.min(window.innerWidth - w - EDGE, a.left));
  pos.value = { left: Math.round(left), top: Math.round(Math.max(EDGE, Math.min(window.innerHeight - hgt - EDGE, top))) };
}
onMounted(place);
watch(() => [props.anchor, props.config, props.title], () => nextTick(place));

const style = computed(() => ({
  ...(props.anchor ? { left: `${pos.value.left}px`, top: `${pos.value.top}px` } : {}),
  ...(props.config.color ? { "--wp-note-tone": noteColorCss(props.config.color) } : {}),
}));
const hasTitle = computed(() => props.title.trim() !== "" && props.title !== "WP Note");
</script>

<template>
  <div
    ref="card"
    class="wp-note-peek"
    :class="{ 'wp-note-peek--static': !anchor }"
    :style="style"
    :role="anchor ? 'tooltip' : undefined"
    data-test="note-peek"
  >
    <div v-if="hasTitle" class="wp-note-peek__title">{{ title }}</div>
    <div class="wp-note-peek__body">
      <NoteMarkdown v-if="config.text.trim()" :text="config.text" :images="config.images" />
      <p v-else class="wp-note-peek__empty">No text yet.</p>
    </div>
    <div v-if="anchor" class="wp-note-peek__actions">
      <Button class="wp-note-peek__edit" size="sm" variant="ghost" icon="pi-pencil" data-test="note-peek-edit" @click="emit('edit')">Edit</Button>
    </div>
  </div>
</template>

<style scoped>
.wp-note-peek {
  --wp-note-tone: var(--wp-accent);
  position: fixed;
  z-index: 1300;
  box-sizing: border-box;
  width: max-content;
  max-width: min(340px, calc(100vw - 16px));
  padding: 10px 12px;
  border: 1px solid var(--wp-border-strong, var(--wp-border));
  border-top: 3px solid var(--wp-note-tone);
  border-radius: min(10px, var(--wp-radius-cap, 999px));
  background: var(--wp-bg-2);
  box-shadow: var(--wp-shadow-md, 0 8px 24px rgb(0 0 0 / 0.45));
  font-family: var(--wp-font-sans, Inter, sans-serif);
  font-size: 13px;
  line-height: 20px;
  color: var(--wp-text-muted, var(--wp-text));
  overflow-wrap: anywhere;
}
.wp-note-peek--static { position: relative; z-index: auto; max-width: 340px; }
.wp-note-peek__title { font-weight: 650; color: var(--wp-text); margin-bottom: 4px; }
.wp-note-peek__empty { margin: 0; color: var(--wp-text-dim); }
.wp-note-peek__actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.wp-note-peek__edit { margin-left: auto; }
</style>
