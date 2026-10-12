<script setup lang="ts">
/**
 * AiPanelFrame — the box every "describe it, review it" AI panel shares:
 * the AI title and model pill, the request box, Ask / Stop / Close, the
 * waiting line and the error line. The panel's own review list goes in the
 * default slot.
 */
import { computed } from "vue";
import Button from "../ui/Button.vue";
import { useAiConfig } from "../../composables/useAiConfig";

interface Props {
  placeholder: string;
  /** Label of the ask button before the first answer. */
  verb: string;
  loading: boolean;
  /** An answer is showing, so the button reads "Ask again". */
  answered: boolean;
  error: string;
  /** Extra reason the ask button is off (no options yet, …). */
  blocked?: boolean;
  /** One line under the title saying what the model sees. */
  scope?: string;
  /** The request box may stay empty (it only steers the answer). */
  optional?: boolean;
}
const props = defineProps<Props>();
const instruction = defineModel<string>({ required: true });
const emit = defineEmits<{ (e: "run"): void; (e: "stop"): void; (e: "close"): void }>();

const { config } = useAiConfig();
const modelLabel = computed(() => config.value?.model ?? "");
const isLocal = computed(() => {
  const c = config.value;
  return c ? c.presets[c.provider].local : true;
});
const canRun = computed(
  () => (props.optional || !!instruction.value.trim()) && !props.loading && !props.blocked,
);

function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    if (canRun.value) emit("run");
  }
}
</script>

<template>
  <div class="wp-ai-frame" data-test="ai-panel">
    <div class="wp-ai-frame__head">
      <span class="wp-ai-frame__title"><i class="pi pi-microchip-ai" aria-hidden="true" /> AI</span>
      <span v-if="scope" class="wp-ai-frame__scope" data-test="ai-scope">{{ scope }}</span>
      <span
        class="wp-ai-frame__model"
        :data-local="isLocal ? 'true' : 'false'"
        :title="isLocal ? 'Runs on your machine' : 'Sent to a cloud provider'"
      >{{ modelLabel }}</span>
    </div>
    <textarea
      v-model="instruction"
      class="wp-textarea wp-ai-frame__input"
      :rows="optional ? 1 : 2"
      :placeholder="placeholder"
      aria-label="What should the AI do?"
      data-test="ai-instruction"
      :disabled="loading"
      @keydown="onKeydown"
    ></textarea>
    <div class="wp-ai-frame__controls">
      <span class="wp-ai-frame__hint">You review everything first. Ctrl+Enter asks.</span>
      <span class="wp-ai-frame__spacer" />
      <Button variant="ghost" size="sm" data-test="ai-close" @click="emit('close')">Close</Button>
      <Button v-if="loading" size="sm" icon="pi-stop" data-test="ai-stop" @click="emit('stop')">Stop</Button>
      <Button
        v-else
        variant="primary"
        size="sm"
        icon="pi-microchip-ai"
        :disabled="!canRun"
        data-test="ai-run"
        @click="emit('run')"
      >{{ answered ? "Ask again" : verb }}</Button>
    </div>
    <p v-if="loading" class="wp-ai-frame__status" role="status" data-test="ai-loading">
      <i class="pi pi-spin pi-spinner" aria-hidden="true" /> Asking {{ modelLabel || "the model" }}… local models can take a minute.
    </p>
    <p v-if="error" class="wp-ai-frame__error" role="alert" data-test="ai-error">{{ error }}</p>
    <slot />
  </div>
</template>

<style scoped>
.wp-ai-frame {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  margin-bottom: 12px;
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 40%, var(--wp-border));
  border-radius: 8px;
  background: color-mix(in oklab, var(--wp-accent-500) 5%, var(--wp-bg-2));
}
.wp-ai-frame__head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.wp-ai-frame__title { font-weight: 600; color: var(--wp-accent-text); display: inline-flex; gap: 6px; align-items: center; }
.wp-ai-frame__scope { font-size: 12px; color: var(--wp-text-muted); }
.wp-ai-frame__model {
  margin-left: auto;
  font-family: var(--wp-font-mono, monospace);
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 5px;
  color: var(--wp-warn);
  border: 1px solid color-mix(in oklab, var(--wp-warn) 45%, transparent);
}
.wp-ai-frame__model[data-local="true"] { color: var(--wp-success); border-color: color-mix(in oklab, var(--wp-success) 45%, transparent); }
.wp-ai-frame__input { width: 100%; resize: vertical; overscroll-behavior: contain; font-size: 13px; }
.wp-ai-frame__controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.wp-ai-frame__hint { font-size: 12px; color: var(--wp-text-dim); }
.wp-ai-frame__spacer { flex: 1; }
.wp-ai-frame__status { margin: 0; font-size: 12px; color: var(--wp-text-muted); display: flex; gap: 6px; align-items: center; }
.wp-ai-frame__error { margin: 0; font-size: 12px; color: var(--wp-danger); }
</style>
