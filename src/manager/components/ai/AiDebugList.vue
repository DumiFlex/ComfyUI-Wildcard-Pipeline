<script setup lang="ts">
/**
 * The top bar's AI debug list (Settings › AI assistant › Debug log): the
 * AI requests the server kept, newest first, each with Copy debug (the
 * Markdown copy: prompt, reply, thinking, tool calls, tokens) and Copy
 * JSON. Loaded only while the log is on.
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import Button from "../ui/Button.vue";
import {
  aiDebugSent, aiDebugUnseen, clearAiDebug, fetchAiDebug, listAiDebug, type AiDebugRow,
} from "../../api/ai-debug";
import { copyText } from "../../utils/clipboard";

const emit = defineEmits<{ close: [] }>();

const rows = ref<AiDebugRow[]>([]);
const folder = ref("");
const failed = ref("");
const copied = ref<{ id: string; what: "md" | "json" } | null>(null);
const busy = ref<string | null>(null);

async function load(): Promise<void> {
  try {
    const got = await listAiDebug();
    rows.value = got.records;
    folder.value = got.folder;
    failed.value = "";
  } catch (e) {
    failed.value = e instanceof Error ? e.message : String(e);
  }
}

async function copy(row: AiDebugRow, what: "md" | "json"): Promise<void> {
  busy.value = row.id + what;
  try {
    const text = await fetchAiDebug(row.id, what);
    if (await copyText(text)) {
      copied.value = { id: row.id, what };
      setTimeout(() => {
        if (copied.value?.id === row.id && copied.value.what === what) copied.value = null;
      }, 1600);
      failed.value = "";
    } else {
      failed.value = "The browser didn't allow copying. Try again after clicking the page.";
    }
  } catch (e) {
    failed.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = null;
  }
}

async function clear(): Promise<void> {
  await clearAiDebug();
  await load();
}

function time(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}

function tokens(r: AiDebugRow): string {
  const t = r.tokens;
  if (t.prompt === undefined && t.output === undefined) return "";
  const cached = t.cached ? ` (${t.cached} cached)` : "";
  return `${t.prompt ?? 0}${cached} in · ${t.output ?? 0} out`;
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") emit("close");
}

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  aiDebugUnseen.value = 0;
  void load();
  // A request still running shows up when it finishes.
  timer = setInterval(() => { if (rows.value.some((r) => r.seconds === null)) void load(); }, 2000);
  window.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  window.removeEventListener("keydown", onKey);
});
watch(() => aiDebugSent.value.length, () => {
  aiDebugUnseen.value = 0;
  void load();
});
</script>

<template>
  <section class="wp-ai-debug" role="dialog" aria-label="AI debug log" data-test="ai-debug-list">
    <header class="wp-ai-debug__head">
      <h2 class="wp-ai-debug__title">AI debug log</h2>
      <button type="button" class="wp-ai-debug__link" data-test="ai-debug-clear" @click="clear">Clear</button>
      <button type="button" class="wp-ai-debug__close" aria-label="Close" data-test="ai-debug-close" @click="emit('close')">
        <i class="pi pi-times" aria-hidden="true" />
      </button>
    </header>
    <p class="wp-ai-debug__note">
      Each AI request with every model call it made: the prompt as sent, the reply, thinking,
      tool calls and tokens. <b>Copy debug</b> gives a readable copy to paste anywhere.
      <template v-if="folder"> Also saved as files in <code>{{ folder }}</code>.</template>
    </p>
    <p v-if="failed" class="wp-ai-debug__error" role="alert">{{ failed }}</p>
    <p v-if="!rows.length && !failed" class="wp-ai-debug__empty" data-test="ai-debug-empty">
      Nothing yet. Use any AI feature and it shows up here.
    </p>
    <ul v-else class="wp-ai-debug__rows">
      <li
        v-for="r in rows"
        :key="r.id"
        class="wp-ai-debug__row"
        :data-state="r.seconds === null ? 'running' : r.error || r.failed ? 'error' : 'ok'"
        data-test="ai-debug-row"
      >
        <div class="wp-ai-debug__main">
          <span class="wp-ai-debug__label">{{ r.label }}</span>
          <span class="wp-ai-debug__meta">
            {{ time(r.started) }}
            · <template v-if="r.seconds === null">running</template><template v-else>{{ r.seconds }} s</template>
            · {{ r.calls }} {{ r.calls === 1 ? "call" : "calls" }}
            <template v-if="tokens(r)"> · {{ tokens(r) }}</template>
          </span>
          <span v-if="r.error || r.failed" class="wp-ai-debug__err">
            {{ r.error || `${r.failed} model ${r.failed === 1 ? "call" : "calls"} failed` }}
          </span>
        </div>
        <div class="wp-ai-debug__actions">
          <Button
            variant="outline" size="sm"
            :disabled="busy === r.id + 'md'"
            data-test="ai-debug-copy"
            @click="copy(r, 'md')"
          >{{ copied?.id === r.id && copied.what === "md" ? "Copied" : "Copy debug" }}</Button>
          <Button
            size="sm"
            :disabled="busy === r.id + 'json'"
            data-test="ai-debug-copy-json"
            @click="copy(r, 'json')"
          >{{ copied?.id === r.id && copied.what === "json" ? "Copied" : "JSON" }}</Button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.wp-ai-debug {
  position: fixed;
  top: calc(var(--wp-topbar-h) + 6px);
  right: 12px;
  z-index: 60;
  width: min(460px, calc(100vw - 24px));
  max-height: min(70vh, 640px);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--wp-bg-2);
  color: var(--wp-text);
  border: 1px solid var(--wp-border);
  border-radius: 10px;
  box-shadow: var(--wp-shadow-lg);
}
.wp-ai-debug__head { display: flex; align-items: center; gap: 8px; }
.wp-ai-debug__title { margin: 0; font-size: 14px; font-weight: 600; flex: 1; }
.wp-ai-debug__link, .wp-ai-debug__close {
  background: none; border: 0; color: var(--wp-text-muted); cursor: pointer;
  font: inherit; font-size: 12px; padding: 2px 6px; border-radius: 4px;
}
.wp-ai-debug__link:hover, .wp-ai-debug__close:hover { color: var(--wp-text); }
.wp-ai-debug__note, .wp-ai-debug__empty { margin: 0; font-size: 12px; color: var(--wp-text-muted); line-height: 1.45; }
.wp-ai-debug__note code { font-size: 11px; word-break: break-all; }
.wp-ai-debug__error { margin: 0; font-size: 12px; color: var(--wp-danger-text); }
.wp-ai-debug__rows { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.wp-ai-debug__row {
  display: flex; gap: 8px; align-items: center; padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--wp-border);
  border-left-width: 3px;
}
.wp-ai-debug__row[data-state="ok"] { border-left-color: var(--wp-success); }
.wp-ai-debug__row[data-state="error"] { border-left-color: var(--wp-danger-text); }
.wp-ai-debug__row[data-state="running"] { border-left-color: var(--wp-accent); }
.wp-ai-debug__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.wp-ai-debug__label { font-size: 13px; font-weight: 600; }
.wp-ai-debug__meta { font-size: 11px; color: var(--wp-text-muted); font-variant-numeric: tabular-nums; }
.wp-ai-debug__err { font-size: 11px; color: var(--wp-danger-text); overflow-wrap: anywhere; }
.wp-ai-debug__actions { display: flex; gap: 4px; flex-shrink: 0; }
.wp-ai-debug__link:focus-visible, .wp-ai-debug__close:focus-visible {
  outline: 2px solid var(--wp-accent); outline-offset: 1px;
}
</style>
