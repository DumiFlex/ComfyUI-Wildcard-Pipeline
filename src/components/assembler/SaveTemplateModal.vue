<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../../manager/api/client";
import ModalShell from "../shared/ModalShell.vue";

const props = defineProps<{
  open: boolean;
  templateString: string;
  /** Library identity of the template this assembler loaded, if any.
   *  Pre-fills the name and makes "Update existing" target that exact
   *  row even before the same-name collision map resolves. */
  loadedRef?: { id: string; name: string } | null;
}>();
const emit = defineEmits<{ close: []; saved: [{ id: string; name: string }] }>();

const name = ref("");
const description = ref("");
const tagsText = ref("");
const categoryId = ref<string | null>(null);
const busy = ref(false);
const errorMsg = ref("");
/** name -> id of existing templates, for same-name update detection. */
const existingByName = ref<Map<string, string>>(new Map());
const categories = ref<{ id: string; name: string }[]>([]);

const tagsParsed = computed<string[]>(() =>
  tagsText.value.split(",").map((t) => t.trim()).filter((t) => t.length > 0),
);

/** The row "Update existing" overwrites. Prefer the loaded row (by id)
 *  while its name is unchanged; else fall back to a same-name library
 *  collision. Null → no update target, so the only action is create. */
const updateTargetId = computed<string | null>(() => {
  const n = name.value.trim();
  if (!n) return null;
  if (props.loadedRef && n === props.loadedRef.name) return props.loadedRef.id;
  return existingByName.value.get(n) ?? null;
});

const canSubmit = computed(
  () => !!name.value.trim() && !!props.templateString && !busy.value,
);

watch(() => props.open, async (open) => {
  if (!open) return;
  name.value = props.loadedRef?.name ?? "";
  description.value = "";
  tagsText.value = "";
  categoryId.value = null;
  errorMsg.value = "";
  const [tpls, cats] = await Promise.allSettled([
    api.templates.list({}),
    api.categories.list(),
  ]);
  existingByName.value = tpls.status === "fulfilled"
    ? new Map(tpls.value.items.map((t) => [t.name, t.id]))
    : new Map();
  categories.value = cats.status === "fulfilled" ? cats.value.items : [];
}, { immediate: true });

async function submit(mode: "update" | "new") {
  if (!canSubmit.value) return;
  busy.value = true;
  errorMsg.value = "";
  try {
    const body = {
      name: name.value.trim(),
      template_string: props.templateString,
      description: description.value,
      category_id: categoryId.value,
      tags: tagsParsed.value,
    };
    const target = mode === "update" ? updateTargetId.value : null;
    const row = target
      ? await api.templates.update(target, body)
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
  <ModalShell :visible="open" @close="emit('close')">
    <div class="wp-stm" role="dialog" aria-modal="true" aria-labelledby="wp-stm-title" @click.stop>
      <header class="wp-stm__head">
        <h3 id="wp-stm-title" class="wp-stm__title">Save template</h3>
        <button type="button" class="wp-stm__close" aria-label="Close" data-test="save-tpl-close" @click="emit('close')">
          <i class="pi pi-times" aria-hidden="true" />
        </button>
      </header>

      <div class="wp-stm__body">
        <div class="wp-stm-field">
          <label class="wp-stm-field__label" for="wp-stm-name">Name</label>
          <input
            id="wp-stm-name"
            v-model="name"
            type="text"
            class="wp-stm-input"
            data-test="save-tpl-name"
            placeholder="e.g. cinematic portrait"
          />
        </div>

        <div v-if="updateTargetId" class="wp-stm-note" data-test="save-tpl-update-existing">
          <i class="pi pi-info-circle" aria-hidden="true" />
          A template named “{{ name.trim() }}” already exists — “Update existing” overwrites it.
        </div>

        <div class="wp-stm-field">
          <label class="wp-stm-field__label" for="wp-stm-desc">Description</label>
          <textarea
            id="wp-stm-desc"
            v-model="description"
            class="wp-stm-input wp-stm-input--multi"
            rows="2"
          />
        </div>

        <div class="wp-stm-row">
          <div class="wp-stm-field wp-stm-field--grow">
            <label class="wp-stm-field__label" for="wp-stm-cat">Category</label>
            <select
              id="wp-stm-cat"
              v-model="categoryId"
              class="wp-stm-input wp-stm-select"
              data-test="save-tpl-category"
            >
              <option :value="null">Uncategorized</option>
              <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>
          <div class="wp-stm-field wp-stm-field--grow">
            <label class="wp-stm-field__label" for="wp-stm-tags">Tags (comma-separated)</label>
            <input
              id="wp-stm-tags"
              v-model="tagsText"
              type="text"
              class="wp-stm-input"
              placeholder="e.g. style, portrait"
            />
          </div>
        </div>

        <div class="wp-stm-field">
          <label class="wp-stm-field__label">Template preview</label>
          <pre class="wp-stm-preview" data-test="save-tpl-preview">{{ templateString || "(empty)" }}</pre>
        </div>

        <p v-if="errorMsg" class="wp-stm-error" data-test="save-tpl-error">{{ errorMsg }}</p>
      </div>

      <footer class="wp-stm__foot">
        <button type="button" class="wp-stm-btn" data-test="save-tpl-cancel" @click="emit('close')">Cancel</button>
        <span class="wp-stm-spacer" />
        <button
          v-if="updateTargetId"
          type="button"
          class="wp-stm-btn"
          :disabled="!canSubmit"
          data-test="save-tpl-save-new"
          @click="submit('new')"
        >Save as new entry</button>
        <button
          type="button"
          class="wp-stm-btn wp-stm-btn--primary"
          :disabled="!canSubmit"
          data-test="save-tpl-submit"
          @click="submit(updateTargetId ? 'update' : 'new')"
        >{{ updateTargetId ? "Update existing" : "Save" }}</button>
      </footer>
    </div>
  </ModalShell>
</template>

<style scoped>
@import "../shared/theme.css";

.wp-stm {
  width: min(560px, 100%);
  max-height: calc(100vh - 40px);
  background: var(--wp-bg-1, #0b0b12);
  border: 1px solid var(--wp-border-strong, var(--wp-border, #2a2a3a));
  border-radius: var(--wp-radius-lg, 12px);
  box-shadow: var(--wp-shadow-lg, 0 20px 60px rgba(0, 0, 0, 0.55));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--wp-text, #e7e7ee);
  font-family: var(--wp-font-sans, sans-serif);
}
.wp-stm__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 16px;
  border-bottom: 1px solid var(--wp-border, #2a2a3a);
  background: var(--wp-brand-gradient, transparent);
  position: relative;
}
.wp-stm__head::after {
  content: "";
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--wp-bg, #0b0b12) 85%, transparent);
  pointer-events: none;
}
.wp-stm__head > * { position: relative; z-index: 1; }
.wp-stm__title { margin: 0; font-size: 14px; font-weight: 600; }
.wp-stm__close {
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--wp-text-muted);
  cursor: pointer;
  transition: background var(--wp-motion-quick) ease, color var(--wp-motion-quick) ease;
}
.wp-stm__close:hover { background: var(--wp-bg-3); color: var(--wp-text); }
.wp-stm__close .pi { font-size: 11px; }

.wp-stm__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.wp-stm-field { display: flex; flex-direction: column; gap: 4px; }
.wp-stm-field--grow { flex: 1; min-width: 0; }
.wp-stm-row { display: flex; gap: 10px; }
.wp-stm-field__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--wp-text-dim);
}
.wp-stm-input {
  width: 100%;
  background: var(--wp-bg-2, #15151f);
  color: var(--wp-text, #e7e7ee);
  border: 1px solid var(--wp-border, #2a2a3a);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
  font-family: inherit;
}
.wp-stm-input:focus { outline: 1px solid var(--wp-accent-500, var(--wp-accent)); }
.wp-stm-input--multi { resize: vertical; min-height: 46px; }
.wp-stm-select { cursor: pointer; }
.wp-stm-preview {
  margin: 0;
  padding: 8px 10px;
  background: var(--wp-bg-2, #15151f);
  border: 1px solid var(--wp-border, #2a2a3a);
  border-radius: 6px;
  font-family: var(--wp-font-mono, monospace);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-y: auto;
  max-height: 110px;
  color: var(--wp-text-muted, #a1a1ad);
}
.wp-stm-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 7px 10px;
  background: color-mix(in srgb, var(--wp-accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--wp-accent) 35%, transparent);
  border-radius: 6px;
  font-size: 11.5px;
  color: var(--wp-accent-text, var(--wp-text));
}
.wp-stm-note .pi { font-size: 11px; margin-top: 1px; }
.wp-stm-error {
  margin: 0;
  font-size: 11.5px;
  color: var(--wp-danger, #f87171);
}

.wp-stm__foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 16px;
  border-top: 1px solid var(--wp-border, #2a2a3a);
  background: var(--wp-bg-1);
}
.wp-stm-spacer { flex: 1; }
.wp-stm-btn {
  height: 30px;
  padding: 0 13px;
  border-radius: 6px;
  border: 1px solid var(--wp-border);
  background: var(--wp-bg-3);
  color: var(--wp-text);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: background var(--wp-motion-quick) ease, border-color var(--wp-motion-quick) ease;
}
.wp-stm-btn:hover:not(:disabled) { background: var(--wp-bg-4); border-color: var(--wp-border-strong); }
.wp-stm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.wp-stm-btn--primary {
  background: var(--wp-accent-600, var(--wp-accent));
  border-color: var(--wp-accent-500, var(--wp-accent));
  color: #fff;
}
.wp-stm-btn--primary:hover:not(:disabled) { background: var(--wp-accent-500, var(--wp-accent)); }
</style>
