<script setup lang="ts">
/**
 * TemplateEditor — SPA editor for library-tracked prompt templates.
 *
 *   /templates/new       → create-mode
 *   /templates/:id/edit  → edit-mode
 *
 * A template is a single `template_string` ($var tokens), an optional
 * `negative_template` (the Assembler's negative box, `$negatives` marks
 * where the variables' negatives go) plus identity metadata
 * (name/description/category/tags). Far simpler than the bundle
 * editor — no children, color, or cascade.
 */
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import IdentityCard from "../components/IdentityCard.vue";
import { usePanelAction, viaPanel } from "../composables/usePanelAction";
import Card from "../../kit/Card.vue";
import Field from "../../kit/Field.vue";
import RichTextInput from "../components/RichTextInput.vue";
import Button from "../../kit/Button.vue";
import AiTextPanel from "../components/ai/AiTextPanel.vue";
import { useAiConfig } from "../composables/useAiConfig";
import { useToast } from "../../kit/useToast";
import { useReturnTo } from "../composables/useReturnTo";
import {
  registerOpenEditor, draftCreateId, draftSaved, type StagedDraft,
} from "../composables/useOpenEditor";
import { useTemplateStore } from "../stores/templateStore";
import { useCategoryStore } from "../stores/categoryStore";
import LoadingMark from "@/kit/LoadingMark.vue";

const props = defineProps<{ id?: string }>();

const route = useRoute();
const router = useRouter();
const { resolveReturnTo } = useReturnTo();
const store = useTemplateStore();
const categoryStore = useCategoryStore();
const toast = useToast();

const editingId = computed<string | null>(
  () => props.id ?? (route.params.id as string | undefined) ?? null,
);
const isEdit = computed(() => editingId.value !== null);

const ai = useAiConfig();
const aiOpen = ref(false);
function useAiPrompt(p: Record<string, unknown>): void {
  if (typeof p.template_string === "string") templateString.value = p.template_string;
  if (typeof p.negative_template === "string") negativeTemplate.value = p.negative_template;
}

const name = ref("");
const description = ref("");
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const templateString = ref("");
const negativeTemplate = ref("");
/** The row's stored negative. `null` = saved before negatives existed; kept
 *  null on save while the field stays empty, so loading that template still
 *  leaves the Assembler's negative box alone. */
const negativeOriginal = ref<string | null>(null);

const loading = ref(false);
const saving = ref(false);

/** Serialized baseline for the dirty check — set after load / save. */
const baseline = ref("");
function snapshot(): string {
  return JSON.stringify({
    name: name.value, description: description.value,
    categoryId: categoryId.value, tags: tags.value,
    templateString: templateString.value,
    negativeTemplate: negativeTemplate.value,
  });
}
const dirty = computed(() => snapshot() !== baseline.value);

/** Load a stored template's text into the editor (saved row or chat draft). */
function loadContent(src: { template_string?: unknown; negative_template?: unknown }): void {
  templateString.value = typeof src.template_string === "string" ? src.template_string : "";
  negativeOriginal.value = typeof src.negative_template === "string" ? src.negative_template : null;
  negativeTemplate.value = negativeOriginal.value ?? "";
}

/** Templates carry no rating; the chat spec wants one, so it stays "safe". */
const contentRating = ref<"safe" | "nsfw">("safe");
// The chat reads and edits this item here, text included.
// A new template fills from a draft the chat staged (see onMounted).
const fillFromChat = registerOpenEditor({
  id: editingId.value ?? undefined, type: "template", dirty: () => dirty.value,
  name, description, tags, categoryId, contentRating,
  extra: () => ({ template_string: templateString.value, negative_template: negativeTemplate.value }),
  setExtra: (body) => {
    if (typeof body.template_string === "string") templateString.value = body.template_string;
    if (typeof body.negative_template === "string") negativeTemplate.value = body.negative_template;
  },
  rebase: () => { baseline.value = snapshot(); },
});
// The chat's `use_panel`: Describe, or ask the Draft with AI panel.
const identityCard = ref<InstanceType<typeof IdentityCard> | null>(null);
const aiPanelRef = ref<InstanceType<typeof AiTextPanel> | null>(null);
usePanelAction({ id: () => editingId.value, identity: identityCard, panels: { draft: viaPanel(aiOpen, aiPanelRef) } });
/** The chat's draft this new template was opened with (Save creates it at
 *  the id the card reserved, if any, and marks the card applied). */
let chatDraft: StagedDraft | null = null;

onMounted(async () => {
  loading.value = true;
  try {
    await categoryStore.fetchAll();
    if (editingId.value) {
      const row = await store.get(editingId.value);
      name.value = row.name;
      description.value = row.description;
      categoryId.value = row.category_id;
      tags.value = [...row.tags];
      loadContent(row);
    }
    baseline.value = snapshot();
    // "Open in editor" on a chat card: the proposed template, unsaved. Its
    // text sits at the top level of a template create body.
    if (!editingId.value) {
      chatDraft = fillFromChat();
      if (chatDraft) {
        const body: Record<string, unknown> = { ...chatDraft.body };
        loadContent(body);
        toast.push({
          severity: "info",
          summary: "From the assistant",
          detail: chatDraft.newCategory
            ? `Check it and Save to keep it. It suggested a new category, "${chatDraft.newCategory}": create it from the Category picker if you want it.`
            : "Check it and Save to keep it.",
        });
      }
    }
  } catch (e) {
    toast.push({ severity: "error", summary: "Load failed", detail: String(e), life: 4000 });
  } finally {
    loading.value = false;
  }
});

async function save() {
  if (!name.value.trim()) {
    toast.push({ severity: "error", summary: "Name is required", life: 3000 });
    return;
  }
  saving.value = true;
  try {
    const body = {
      name: name.value.trim(),
      description: description.value,
      category_id: categoryId.value,
      tags: [...tags.value],
      template_string: templateString.value,
      negative_template:
        negativeTemplate.value === "" && negativeOriginal.value === null && isEdit.value
          ? null
          : negativeTemplate.value,
    };
    if (editingId.value) await store.update(editingId.value, body);
    else {
      const created = await store.create({ ...draftCreateId(chatDraft), ...body });
      draftSaved(chatDraft, created?.id);
      chatDraft = null;
    }
    negativeOriginal.value = body.negative_template;
    baseline.value = snapshot();
    toast.push({ severity: "success", summary: "Saved", detail: name.value });
    router.push(resolveReturnTo("/templates"));
  } catch (e) {
    toast.push({ severity: "error", summary: "Save failed", detail: String(e), life: 4000 });
  } finally {
    saving.value = false;
  }
}

function cancel() {
  router.push(resolveReturnTo("/templates"));
}
</script>

<template>
  <EditorFrame
    :title="isEdit ? (name || 'Loading…') : 'New template'"
    back-route="/templates"
    back-label="Templates"
    :saving="saving"
    :dirty="dirty"
    @save="save"
    @cancel="cancel"
  >
    <LoadingMark v-if="loading" :size="40" block>Loading template…</LoadingMark>
    <template v-else>
      <IdentityCard
        ref="identityCard"
        ai-kind="template"
        :ai-payload="() => ({ template: templateString, negative: negativeTemplate })"
        :name="name"
        :description="description"
        :category-id="categoryId"
        :tags="tags"
        @update:name="(v) => (name = v)"
        @update:description="(v) => (description = v)"
        @update:category-id="(v) => (categoryId = v)"
        :show-content-rating="false"
        @update:tags="(v) => (tags = v)"
      />
      <Card title="Prompt">
        <template v-if="ai.config.value?.enabled" #actions>
          <Button
            size="sm"
            :variant="aiOpen ? 'secondary' : 'ghost'"
            icon="pi-microchip-ai"
            data-test="tpl-ai"
            @click="aiOpen = !aiOpen"
          >AI</Button>
        </template>
        <AiTextPanel
          ref="aiPanelRef"
          v-if="aiOpen && ai.config.value?.enabled"
          kind="template"
          :item="{ id: editingId ?? undefined, name, description, tags, template_string: templateString, negative_template: negativeTemplate }"
          @use="useAiPrompt"
          @close="aiOpen = false"
        />
        <Field label="Template" hint="The PromptAssembler template string — $var tokens are resolved at render.">
          <!-- The same editor the assembler node uses, on the same surface.
               A template IS an assembler template string — saved here, loaded
               there — so the two have to agree about what the syntax means and
               what may be completed in it. As a plain textarea this was the
               one place you could write a template with no tag, LoRA or
               embedding completion at all. -->
          <RichTextInput
            v-model="templateString"
            surface="assembler"
            multiline
            :rows="5"
            placeholder="$subject wearing $outfit, $style, $lighting"
            aria-label="Template"
          />
        </Field>
        <Field
          label="Negative template"
          hint="The Assembler's negative box. $negatives is where the negatives of the variables the template uses go; empty = just those words, no $negatives = they are added at the end."
        >
          <RichTextInput
            v-model="negativeTemplate"
            class="wp-tpl-editor__neg"
            surface="assembler"
            multiline
            :rows="2"
            :var-suggestions="['negatives']"
            placeholder="$negatives"
            aria-label="Negative template"
            data-test="tpl-negative"
          />
        </Field>
      </Card>
    </template>
  </EditorFrame>
</template>

<style scoped>
.wp-tpl-editor__neg {
  border-color: color-mix(in srgb, var(--wp-danger) 40%, var(--wp-border));
}
</style>
