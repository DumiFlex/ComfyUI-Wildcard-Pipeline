<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import WpButton from "../../kit/WpButton.vue";
import NoteMarkdown from "./note-markdown";
import { docTitle, type NoteConfig } from "../../extension/note";

/** The hover card of a Label note: its text, its docs link and an Edit
 *  button. Placed above the label (below when there is no room). */
const props = defineProps<{
  config: NoteConfig;
  title: string;
  anchor: DOMRect;
}>();

const emit = defineEmits<{
  (e: "open-doc", id: string): void;
  (e: "edit"): void;
}>();

const card = ref<HTMLElement | null>(null);
const pos = ref({ left: 0, top: 0 });
const GAP = 8;
const EDGE = 8;

function place(): void {
  const el = card.value;
  if (!el) return;
  const a = props.anchor;
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
  left: `${pos.value.left}px`,
  top: `${pos.value.top}px`,
  ...(props.config.color ? { "--wp-note-tone": props.config.color } : {}),
}));
const hasTitle = computed(() => props.title.trim() !== "" && props.title !== "WP Note");
</script>

<template>
  <div
    ref="card"
    class="wp-note-peek"
    :class="`wp-note-peek--${config.tone}`"
    :style="style"
    role="tooltip"
    data-test="note-peek"
  >
    <div v-if="hasTitle" class="wp-note-peek__title">{{ title }}</div>
    <div class="wp-note-peek__body">
      <NoteMarkdown v-if="config.text.trim()" :text="config.text" />
      <p v-else class="wp-note-peek__empty">No text yet.</p>
    </div>
    <div class="wp-note-peek__actions">
      <button
        v-if="config.doc"
        type="button"
        class="wp-note-peek__doc"
        data-test="note-peek-doc"
        @click="emit('open-doc', config.doc)"
      ><i class="pi pi-book" aria-hidden="true"></i>{{ docTitle(config.doc) }} docs<i class="pi pi-arrow-up-right" aria-hidden="true"></i></button>
      <WpButton class="wp-note-peek__edit" size="sm" variant="ghost" icon="pi-pencil" data-test="note-peek-edit" @click="emit('edit')">Edit</WpButton>
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
.wp-note-peek--tip { --wp-note-tone: var(--wp-success); }
.wp-note-peek--info { --wp-note-tone: var(--wp-info); }
.wp-note-peek--plain { --wp-note-tone: var(--wp-text-dim); }
.wp-note-peek__title { font-weight: 650; color: var(--wp-text); margin-bottom: 4px; }
.wp-note-peek__empty { margin: 0; color: var(--wp-text-dim); }
.wp-note-peek__actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.wp-note-peek__edit { margin-left: auto; }
.wp-note-peek__doc {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border: 1px solid color-mix(in srgb, var(--wp-note-tone) 50%, transparent);
  border-radius: var(--wp-radius-cap, 999px);
  background: color-mix(in srgb, var(--wp-note-tone) 12%, transparent);
  font: inherit;
  font-size: 12px;
  color: var(--wp-text);
  cursor: pointer;
}
.wp-note-peek__doc .pi { font-size: 11px; color: var(--wp-note-tone); }
.wp-note-peek__doc:hover { background: color-mix(in srgb, var(--wp-note-tone) 24%, transparent); }
.wp-note-peek__doc:focus-visible { outline: 2px solid var(--wp-focus-ring, var(--wp-accent)); outline-offset: 2px; }
</style>
