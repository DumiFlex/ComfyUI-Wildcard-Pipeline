<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../../manager/api/client";
import Modal from "@/kit/Modal.vue";
import Textarea from "@/kit/Textarea.vue";
import Input from "@/kit/Input.vue";
import WpSelect from "@/kit/WpSelect.vue";
import { pushToast } from "../shared/toast-store";
import Button from "@/kit/Button.vue";
import CodeBlock from "@/kit/CodeBlock.vue";

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
  <Modal :open="open" title="Save template" size="md" flush accent="brand" icon="save" @update:open="(v: boolean) => { if (!v) emit('close'); }">
    <div class="wp-stm">

      <div class="wp-stm__body">
        <div class="wp-stm-field">
          <label class="wp-stm-field__label" for="wp-stm-name">Name</label>
          <Input
            id="wp-stm-name"
            v-model="name"
            size="sm"
           
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
          <Textarea
            id="wp-stm-desc"
            v-model="description"
            class="wp-stm-input wp-stm-input--multi"
            :rows="2"
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
            <Input
              id="wp-stm-tags"
              v-model="tagsText"
              size="sm"
             
              class="wp-stm-input"
              placeholder="e.g. style, portrait"
            />
          </div>
        </div>

        <div class="wp-stm-field">
          <label class="wp-stm-field__label">Template preview</label>
          <CodeBlock class="wp-stm-preview" :code="templateString || '(empty)'" bare default-wrap size="sm" max-height="110px" data-test="save-tpl-preview" />
        </div>

        <div v-if="negativeTemplate" class="wp-stm-field">
          <label class="wp-stm-field__label wp-stm-field__label--neg">Negative template</label>
          <CodeBlock
            class="wp-stm-preview wp-stm-preview--neg"
            :code="negativeTemplate"
            bare
            default-wrap
            size="sm"
            max-height="110px"
            data-test="save-tpl-neg-preview"
          />
        </div>

        <p v-if="errorMsg" class="wp-stm-error" data-test="save-tpl-error">{{ errorMsg }}</p>
      </div>

    </div>
    <template #footer>
      <Button size="sm" data-test="save-tpl-cancel" @click="emit('close')">Cancel</Button>
      <span class="wp-stm-spacer" />
      <Button
        v-if="updateTargetId"
        size="sm"
        :disabled="!canSubmit"
        data-test="save-tpl-save-new"
        @click="submit('new')"
      >Save as new entry</Button>
      <Button
        size="sm"
        variant="primary"
        :disabled="!canSubmit"
        data-test="save-tpl-submit"
        @click="submit(updateTargetId ? 'update' : 'new')"
      >{{ updateTargetId ? "Update existing" : "Save" }}</Button>
    </template>
  </Modal>
</template>

<style scoped>
.wp-stm { display: flex; flex-direction: column; color: var(--wp-text); font-family: var(--wp-font-sans, sans-serif); }

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
/* The kit Textarea draws the box; the description box is two lines tall. */
.wp-stm-input--multi { overscroll-behavior: contain; min-height: 46px; }
.wp-stm-select { width: 100%; height: 32px; font-size: 13px; }

.wp-stm-preview--neg { border-color: color-mix(in srgb, var(--wp-danger) 40%, var(--wp-border)); }
.wp-stm-field__label--neg { color: var(--wp-danger); }
.wp-stm-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 7px 10px;
  background: color-mix(in srgb, var(--wp-accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--wp-accent) 35%, transparent);
  border-radius: min(6px, var(--wp-radius-cap, 999px));
  font-size: 11.5px;
  color: var(--wp-accent-text, var(--wp-text));
}
.wp-stm-note .pi { font-size: 11px; margin-top: 1px; }
.wp-stm-error {
  margin: 0;
  font-size: 11.5px;
  color: var(--wp-danger);
}

.wp-stm-spacer { flex: 1; }
</style>
