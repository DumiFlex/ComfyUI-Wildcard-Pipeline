<script setup lang="ts">
/**
 * Settings › AI assistant › About my library: a short note every chat,
 * Draft with AI and pack builder request reads (`engine/ai/note.py`).
 * Saved with an explicit Save, not on every key, because each save starts
 * new chats on the new note. Suggest asks the model for a first draft from
 * the library summary; nothing is saved until the user presses Save.
 */
import { computed, ref, watch } from "vue";
import Button from "../../../kit/Button.vue";
import Textarea from "../../../kit/Textarea.vue";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";
import { api } from "../../api/client";
import { useAiConfig } from "../../composables/useAiConfig";

/** Mirrors `engine/ai/note.py` MAX_CHARS. */
const NOTE_MAX = 600;

const { config, save } = useAiConfig();

const saved = computed(() => config.value?.library_note ?? "");
const draft = ref("");
watch(saved, (v) => { draft.value = v; }, { immediate: true });

const length = computed(() => draft.value.trim().length);
const over = computed(() => length.value > NOTE_MAX);
const changed = computed(() => draft.value.trim() !== saved.value);
const off = computed(() => !config.value?.enabled || !config.value?.model);

const saving = ref(false);
const suggesting = ref(false);
const problem = ref("");
/** "Suggested by <model>": shown until the draft is saved or put back. */
const suggestedBy = ref("");
const savedNow = ref(false);

async function saveNote(): Promise<void> {
  if (over.value || !changed.value) return;
  saving.value = true;
  problem.value = "";
  try {
    await save({ library_note: draft.value.trim() });
    suggestedBy.value = "";
    savedNow.value = true;
  } catch (err) {
    problem.value = err instanceof Error ? err.message : "Could not save the note";
  } finally {
    saving.value = false;
  }
}

function putBack(): void {
  draft.value = saved.value;
  suggestedBy.value = "";
  problem.value = "";
}

async function suggest(): Promise<void> {
  suggesting.value = true;
  problem.value = "";
  try {
    const got = await api.ai.suggestLibraryNote({ current: draft.value });
    draft.value = got.note;
    suggestedBy.value = got.model;
  } catch (err) {
    problem.value = err instanceof Error ? err.message : "Could not suggest a note";
  } finally {
    suggesting.value = false;
  }
}

watch(draft, () => { savedNow.value = false; });
</script>

<template>
  <SettingGroup title="About my library">
    <SettingRow
      stacked
      label="A note the assistant always reads"
      hint="A few lines about your library that every chat, Draft with AI and the Pack builder read before your request: how you name things, the variables that matter, the checkpoint you write for, what to never add. Keep it short and concrete. A chat keeps the note it started with; new chats read the new one."
      setting-key="ai-library-note"
      for="ai-library-note"
    >
      <div class="wp-libnote">
        <Textarea
          id="ai-library-note"
          v-model="draft"
          :rows="5"
          auto-resize
          :error="over"
          placeholder="My wildcards use booru tags, all lowercase. Variables are snake_case, like $hair_colour. I write for Illustrious. Never add artist names."
          aria-label="About my library"
          data-test="ai-library-note"
        />
        <div class="wp-libnote__bar">
          <span class="wp-libnote__count" :data-over="over || undefined" data-test="ai-library-note-count">{{ length }} / {{ NOTE_MAX }}</span>
          <span v-if="suggestedBy" class="wp-libnote__status" data-test="ai-library-note-suggested">
            <i class="pi pi-sparkles" aria-hidden="true" /> Suggested by {{ suggestedBy }}. Edit it, then Save.
          </span>
          <span v-else-if="savedNow" class="wp-libnote__status" data-tone="ok" data-test="ai-library-note-saved">
            <i class="pi pi-check" aria-hidden="true" /> Saved. New chats read it.
          </span>
          <span class="wp-libnote__actions">
            <Button
              size="sm"
              variant="ghost"
              icon="pi-sparkles"
              :loading="suggesting"
              :disabled="off || saving"
              :title="off ? 'Turn on the assistant and pick a model first' : 'Draft a note from your library. Nothing is saved until you press Save.'"
              data-test="ai-library-note-suggest"
              @click="suggest"
            >Suggest</Button>
            <Button
              v-if="changed"
              size="sm"
              variant="ghost"
              :disabled="saving || suggesting"
              data-test="ai-library-note-revert"
              @click="putBack"
            >Put back</Button>
            <Button
              size="sm"
              icon="pi-check"
              :loading="saving"
              :disabled="!changed || over || suggesting"
              data-test="ai-library-note-save"
              @click="saveNote"
            >Save</Button>
          </span>
        </div>
        <p v-if="over" class="wp-libnote__problem" role="alert" data-test="ai-library-note-over">
          {{ length - NOTE_MAX }} characters over. Small models follow a short note better.
        </p>
        <p v-if="problem" class="wp-libnote__problem" role="alert" data-test="ai-library-note-error">{{ problem }}</p>
      </div>
    </SettingRow>
  </SettingGroup>
</template>

<style scoped>
.wp-libnote { display: flex; flex-direction: column; gap: var(--wp-space-3); width: 100%; min-width: 0; }
.wp-libnote :deep(.wp-textarea) { width: 100%; min-height: 96px; resize: vertical; }
.wp-libnote__bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--wp-space-3) var(--wp-space-4); }
.wp-libnote__count { font-family: var(--wp-font-mono); font-size: 12px; color: var(--wp-text-dim); }
.wp-libnote__count[data-over] { color: var(--wp-danger, var(--wp-warn)); font-weight: 600; }
.wp-libnote__status { display: inline-flex; gap: 6px; align-items: baseline; font-size: var(--wp-text-sm); color: var(--wp-text-muted); }
.wp-libnote__status[data-tone="ok"] { color: var(--wp-success); }
.wp-libnote__status i { font-size: 12px; }
.wp-libnote__actions { display: inline-flex; gap: var(--wp-space-2); margin-left: auto; }
.wp-libnote__problem { margin: 0; font-size: var(--wp-text-sm); color: var(--wp-danger, var(--wp-warn)); }
</style>
