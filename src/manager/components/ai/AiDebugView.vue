<script setup lang="ts">
/**
 * One AI debug record read in a window (the debug list's View): the same
 * Markdown Copy debug gives, drawn like a chat reply, with Copy and JSON
 * beside it. The top bar hosts it, so closing the list's popover doesn't
 * close it.
 */
import { computed, ref, watch } from "vue";
import Modal from "@/kit/Modal.vue";
import Button from "@/kit/Button.vue";
import Banner from "@/kit/Banner.vue";
import LoadingMark from "@/kit/LoadingMark.vue";
import { copyText } from "@/kit/clipboard";
import AiMessage from "./AiMessage.vue";
import { fetchAiDebug, type AiDebugRow } from "../../api/ai-debug";

const props = defineProps<{ row: AiDebugRow | null }>();
const emit = defineEmits<{ close: [] }>();

const text = ref("");
const failed = ref("");
const loading = ref(false);
const copied = ref<"md" | "json" | null>(null);

watch(() => props.row?.id, async (id) => {
  text.value = "";
  failed.value = "";
  if (!id) return;
  loading.value = true;
  try {
    text.value = await fetchAiDebug(id, "md");
  } catch (e) {
    failed.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}, { immediate: true });

/** The chat's Markdown has no HTML: the folded schema's <details> lines
 *  read as plain headings instead. */
const shown = computed(() => text.value
  .replace(/<details><summary>(.*?)<\/summary>/g, "**$1**")
  .replace(/<\/details>/g, ""));

async function copy(what: "md" | "json"): Promise<void> {
  const row = props.row;
  if (!row) return;
  const body = what === "md" ? text.value : await fetchAiDebug(row.id, "json");
  if (await copyText(body)) {
    copied.value = what;
    setTimeout(() => { if (copied.value === what) copied.value = null; }, 1600);
  }
}
</script>

<template>
  <Modal
    :open="!!row"
    :title="row ? `AI debug: ${row.label}` : 'AI debug'"
    size="lg"
    @update:open="(v: boolean) => { if (!v) emit('close'); }"
  >
    <div class="wp-ai-debug-view" data-test="ai-debug-view">
      <LoadingMark v-if="loading" block />
      <Banner v-else-if="failed" tone="danger" size="sm">{{ failed }}</Banner>
      <AiMessage v-else :text="shown" />
    </div>
    <template #footer>
      <Button variant="outline" size="sm" :disabled="!text" data-test="ai-debug-view-copy" @click="copy('md')">
        {{ copied === "md" ? "Copied" : "Copy debug" }}
      </Button>
      <Button size="sm" :disabled="!text" @click="copy('json')">{{ copied === "json" ? "Copied" : "JSON" }}</Button>
    </template>
  </Modal>
</template>

<style scoped>
.wp-ai-debug-view { font-size: 12px; min-height: 120px; }
.wp-ai-debug-view :deep(pre) { max-height: 420px; overflow: auto; }
</style>
