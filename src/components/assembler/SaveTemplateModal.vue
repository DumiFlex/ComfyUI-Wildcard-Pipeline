<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../../manager/api/client";

const props = defineProps<{ open: boolean; templateString: string }>();
const emit = defineEmits<{ close: []; saved: [{ id: string; name: string }] }>();

const name = ref("");
const description = ref("");
const tagsText = ref("");
const busy = ref(false);
const errorMsg = ref("");
/** name -> id of existing templates, for same-name update detection. */
const existingByName = ref<Map<string, string>>(new Map());

const tagsParsed = computed<string[]>(() =>
  tagsText.value.split(",").map((t) => t.trim()).filter((t) => t.length > 0),
);
const collisionId = computed<string | null>(
  () => existingByName.value.get(name.value.trim()) ?? null,
);
const canSubmit = computed(
  () => !!name.value.trim() && !!props.templateString && !busy.value,
);

watch(() => props.open, async (open) => {
  if (!open) return;
  name.value = "";
  description.value = "";
  tagsText.value = "";
  errorMsg.value = "";
  try {
    const res = await api.templates.list({});
    existingByName.value = new Map(res.items.map((t) => [t.name, t.id]));
  } catch {
    existingByName.value = new Map();
  }
}, { immediate: true });

async function submit() {
  if (!canSubmit.value) return;
  busy.value = true;
  errorMsg.value = "";
  try {
    const body = {
      name: name.value.trim(),
      template_string: props.templateString,
      description: description.value,
      tags: tagsParsed.value,
    };
    const row = collisionId.value
      ? await api.templates.update(collisionId.value, body)
      : await api.templates.create(body);
    emit("saved", { id: row.id, name: row.name });
    emit("close");
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : "Save failed";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="wp-modal" appear>
      <div v-if="open" class="wp-stm-overlay" @click="emit('close')">
        <div class="wp-stm-modal" role="dialog" aria-modal="true" @click.stop>
          <h3 class="wp-stm-title">Save template</h3>
          <label class="wp-stm-label">Name
            <input
              v-model="name"
              data-test="save-tpl-name"
              class="wp-stm-input"
              type="text"
              placeholder="e.g. cinematic portrait"
            />
          </label>
          <div v-if="collisionId" data-test="save-tpl-update-existing" class="wp-stm-hint">
            A template named "{{ name.trim() }}" exists — saving will update it.
          </div>
          <label class="wp-stm-label">Description
            <textarea v-model="description" class="wp-stm-input" rows="2" />
          </label>
          <label class="wp-stm-label">Tags (comma-separated)
            <input v-model="tagsText" class="wp-stm-input" type="text" />
          </label>
          <label class="wp-stm-label">Template
            <pre class="wp-stm-preview">{{ templateString || "(empty)" }}</pre>
          </label>
          <p v-if="errorMsg" class="wp-stm-error">{{ errorMsg }}</p>
          <div class="wp-stm-actions">
            <button type="button" class="wp-btn wp-btn--ghost" @click="emit('close')">Cancel</button>
            <button
              type="button"
              class="wp-btn wp-btn--primary"
              :disabled="!canSubmit"
              data-test="save-tpl-submit"
              @click="submit"
            >
              {{ collisionId ? "Update existing" : "Save" }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.wp-stm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}
.wp-stm-modal {
  background: var(--wp-bg-1, #1a1d24);
  border: 1px solid var(--wp-border, #353841);
  border-radius: var(--wp-radius-lg, 12px);
  padding: 16px;
  width: 380px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wp-stm-title {
  margin: 0;
  font: 600 14px var(--wp-font-sans, sans-serif);
  color: var(--wp-text, #e6e6e6);
}
.wp-stm-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--wp-text-muted, #aeb1bb);
}
.wp-stm-input {
  background: var(--wp-bg-deep, var(--wp-bg, #0e1015));
  border: 1px solid var(--wp-border, #353841);
  border-radius: var(--wp-radius, 8px);
  color: var(--wp-text, #e6e6e6);
  padding: 6px 8px;
  font: 13px var(--wp-font-sans, sans-serif);
}
.wp-stm-preview {
  margin: 0;
  background: var(--wp-bg-deep, var(--wp-bg, #0e1015));
  border: 1px solid var(--wp-border, #353841);
  border-radius: var(--wp-radius, 8px);
  padding: 6px 8px;
  font: 12px var(--wp-font-mono, monospace);
  color: var(--wp-text-muted, #aeb1bb);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 96px;
  overflow-y: auto;
}
.wp-stm-hint { font-size: 11px; color: var(--wp-accent, #c4b5fd); }
.wp-stm-error { font-size: 11px; color: var(--wp-danger, #f87171); margin: 0; }
.wp-stm-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
