<script setup lang="ts">
/**
 * TemplateEditor — SPA editor for library-tracked prompt templates.
 *
 *   /templates/new       → create-mode
 *   /templates/:id/edit  → edit-mode
 *
 * A template is a single `template_string` ($var tokens) plus identity
 * metadata (name/description/category/tags). Far simpler than the bundle
 * editor — no children, color, or cascade.
 */
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import EditorFrame from "../components/EditorFrame.vue";
import IdentityCard from "../components/IdentityCard.vue";
import Card from "../components/ui/Card.vue";
import Field from "../components/ui/Field.vue";
import Textarea from "../components/ui/Textarea.vue";
import { useToast } from "../composables/useToast";
import { useReturnTo } from "../composables/useReturnTo";
import { useTemplateStore } from "../stores/templateStore";
import { useCategoryStore } from "../stores/categoryStore";

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

const name = ref("");
const description = ref("");
const categoryId = ref<string | null>(null);
const tags = ref<string[]>([]);
const templateString = ref("");

const loading = ref(false);
const saving = ref(false);

/** Serialized baseline for the dirty check — set after load / save. */
const baseline = ref("");
function snapshot(): string {
  return JSON.stringify({
    name: name.value, description: description.value,
    categoryId: categoryId.value, tags: tags.value,
    templateString: templateString.value,
  });
}
const dirty = computed(() => snapshot() !== baseline.value);

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
      templateString.value = row.template_string;
    }
    baseline.value = snapshot();
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
    };
    if (editingId.value) await store.update(editingId.value, body);
    else await store.create(body);
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
    <div v-if="loading" class="wp-dim wp-tpl-editor__loading">Loading template…</div>
    <template v-else>
      <IdentityCard
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
      <Card>
        <Field label="Template" hint="The PromptAssembler template string — $var tokens are resolved at render.">
          <Textarea
            v-model="templateString"
            :rows="5"
            placeholder="$subject wearing $outfit, $style, $lighting"
            spellcheck="false"
            aria-label="Template"
          />
        </Field>
      </Card>
    </template>
  </EditorFrame>
</template>

<style scoped>
.wp-tpl-editor__loading { padding: var(--wp-space-6); }
</style>
