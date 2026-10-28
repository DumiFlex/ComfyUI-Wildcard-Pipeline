<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../../manager/api/client";
import ModalShell from "../shared/ModalShell.vue";
import WpSelect from "../shared/WpSelect.vue";
import { pushToast } from "../shared/toast-store";
import WpButton from "../shared/WpButton.vue";
import CloseButton from "../shared/CloseButton.vue";

const props = defineProps<{
  open: boolean;
  templateString: string;
  /** The Assembler's negative box. Saved alongside the prompt template
   *  (an empty box saves as "", which loading applies; only templates saved
   *  before negatives existed carry none). */
  negativeTemplate?: string;
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
      negative_template: props.negativeTemplate ?? "",
      description: description.value,
      category_id: categoryId.value,
      tags: tagsParsed.value,
    };
    const target = mode === "update" ? updateTargetId.value : null;
    const row = target
      ? await api.templates.update(target, body)
      : await api.templates.create(body);
    pushToast(
      `${target ? "Updated" : "Saved"} template “${row.name}”`,
      { severity: "success" },
    );
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
        <CloseButton size="sm" kbd="Esc" data-test="save-tpl-close" @click="emit('close')" />
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
            <WpSelect
              id="wp-stm-cat"
              class="wp-stm-select"
              :model-value="categoryId ?? ''"
              :options="[{ value: '', label: 'Uncategorized' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]"
              data-test="save-tpl-category"
              @update:model-value="(v) => categoryId = String(v) || null"
            />
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

        <div v-if="negativeTemplate" class="wp-stm-field">
          <label class="wp-stm-field__label wp-stm-field__label--neg">Negative template</label>
          <pre
            class="wp-stm-preview wp-stm-preview--neg"
            data-test="save-tpl-neg-preview"
          >{{ negativeTemplate }}</pre>
        </div>

        <p v-if="errorMsg" class="wp-stm-error" data-test="save-tpl-error">{{ errorMsg }}</p>
      </div>

      <footer class="wp-stm__foot">
        <WpButton data-test="save-tpl-cancel" @click="emit('close')">Cancel</WpButton>
        <span class="wp-stm-spacer" />
        <WpButton
          v-if="updateTargetId"
          :disabled="!canSubmit"
          data-test="save-tpl-save-new"
          @click="submit('new')"
        >Save as new entry</WpButton>
        <WpButton
          variant="primary"
          :disabled="!canSubmit"
          data-test="save-tpl-submit"
          @click="submit(updateTargetId ? 'update' : 'new')"
        >{{ updateTargetId ? "Update existing" : "Save" }}</WpButton>
      </footer>
    </div>
  </ModalShell>
</template>

<style scoped>
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
.wp-stm-input--multi { resize: vertical; overscroll-behavior: contain; min-height: 46px; }
.wp-stm-select { width: 100%; height: 32px; font-size: 13px; }
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
.wp-stm-preview--neg {
  border-color: color-mix(in srgb, var(--wp-danger) 40%, var(--wp-border, #2a2a3a));
}
.wp-stm-field__label--neg { color: var(--wp-danger); }
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
</style>
