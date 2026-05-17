<script setup lang="ts">
/**
 * IdentityCard
 *
 * Shared identity sub-form used by all six module editors. Mirrors the
 * `IdentityCard` helper in the prototype `screens/editors.jsx`. Wraps the
 * common name / category / description / tags fields, plus an optional
 * `$varBinding` input that auto-tracks the (slugified) name until the user
 * edits it.
 *
 * The parent owns the values; this component is dumb and emits patches.
 */
import { computed, ref, watch } from "vue";
import Card from "./ui/Card.vue";
import Field from "./ui/Field.vue";
import Input from "./ui/Input.vue";
import Textarea from "./ui/Textarea.vue";
import Select, { type SelectOption } from "./ui/Select.vue";
import Chip from "./ui/Chip.vue";
import Button from "./ui/Button.vue";
import { useCategoryStore } from "../stores/categoryStore";
import { toIdentifier } from "../utils/slug";

interface Props {
  name: string;
  description: string;
  categoryId: string | null;
  tags: string[];
  /** Optional `$var` binding (Wildcard editor uses this slot). */
  varBinding?: string | null;
  varBindingError?: string;
  varBindingHint?: string;
  /** When true, render the description Textarea. */
  showDescription?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  varBinding: null,
  varBindingError: "",
  varBindingHint: "Reference this in templates as $name. Auto-derived from the name unless you customize it.",
  showDescription: true,
});

const emit = defineEmits<{
  "update:name": [value: string];
  "update:description": [value: string];
  "update:categoryId": [value: string | null];
  "update:tags": [value: string[]];
  "update:varBinding": [value: string];
}>();

const categoryStore = useCategoryStore();

const categoryOptions = computed<SelectOption[]>(() => [
  { value: null, label: "None" },
  ...categoryStore.items.map((c) => ({ value: c.id, label: c.name, dot: c.color || undefined })),
]);

// `varBinding` auto-tracks slugified name until the user touches it.
const varTouched = ref(false);
watch(
  () => props.varBinding,
  (v) => {
    // If parent supplied a non-default value at mount, treat it as touched.
    if (v && v !== toIdentifier(props.name)) varTouched.value = true;
  },
  { immediate: true },
);

function onName(v: string | number) {
  const next = String(v ?? "");
  emit("update:name", next);
  if (props.varBinding != null && !varTouched.value) {
    emit("update:varBinding", toIdentifier(next));
  }
}

function onVarBinding(v: string | number) {
  varTouched.value = true;
  const cleaned = String(v ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "");
  emit("update:varBinding", cleaned);
}

// Tag chip-input — Enter adds, X removes. No autocomplete (prototype's
// `TagInput` is plain). Wave-5 may add a suggestion popover.
const tagDraft = ref("");
function addTag() {
  const t = tagDraft.value.trim();
  if (!t) return;
  if (props.tags.includes(t)) {
    tagDraft.value = "";
    return;
  }
  emit("update:tags", [...props.tags, t]);
  tagDraft.value = "";
}
function removeTag(t: string) {
  emit("update:tags", props.tags.filter((x) => x !== t));
}
</script>

<template>
  <Card title="Identity">
    <div class="identity-grid">
      <div v-if="$slots.nameLeading" class="identity-name-row">
        <slot name="nameLeading" />
        <Field label="Name" class="identity-name-row__field">
          <Input
            :model-value="name"
            placeholder="e.g. Hair Color"
            data-test="identity-name"
            @update:model-value="onName"
          />
        </Field>
      </div>
      <Field v-else label="Name">
        <Input
          :model-value="name"
          placeholder="e.g. Hair Color"
          data-test="identity-name"
          @update:model-value="onName"
        />
      </Field>

      <Field label="Category">
        <Select
          :model-value="categoryId"
          :options="categoryOptions"
          placeholder="None"
          clearable
          aria-label="Category"
          data-test="identity-category"
          @update:model-value="(v) => emit('update:categoryId', (v as string | null) ?? null)"
        />
      </Field>

      <Field
        v-if="varBinding != null"
        label="Variable name"
        :hint="varBindingError ? undefined : varBindingHint"
        :error="varBindingError"
        class="identity-grid__full"
      >
        <div class="wp-input-group">
          <span class="wp-input-group__addon">$</span>
          <input
            class="wp-input wp-mono"
            :value="varBinding ?? ''"
            placeholder="hair_color"
            data-test="identity-var-binding"
            @input="onVarBinding(($event.target as HTMLInputElement).value)"
          />
        </div>
      </Field>

      <Field
        v-if="showDescription"
        label="Description"
        class="identity-grid__full"
      >
        <Textarea
          :model-value="description"
          :rows="3"
          placeholder="What does this module do?"
          aria-label="Description"
          data-test="identity-description"
          @update:model-value="(v) => emit('update:description', v)"
        />
      </Field>

      <Field label="Tags" class="identity-grid__full">
        <div class="identity-tags">
          <Input
            v-model="tagDraft"
            placeholder="Type a tag and press Enter…"
            data-test="identity-tag-input"
            @keydown.enter.prevent="addTag"
          />
          <Button
            variant="secondary"
            icon="pi-plus"
            data-test="identity-tag-add"
            @click="addTag"
          >Add</Button>
        </div>
        <div v-if="tags.length" class="identity-tag-list" data-test="identity-tag-list">
          <Chip
            v-for="t in tags"
            :key="t"
            tone="accent"
            removable
            @remove="removeTag(t)"
          >{{ t }}</Chip>
        </div>
      </Field>
    </div>
  </Card>
</template>

<style scoped>
.identity-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--wp-space-5);
}
.identity-grid__full {
  grid-column: 1 / -1;
}
.identity-tags {
  display: flex;
  gap: var(--wp-space-3);
  align-items: stretch;
}
.identity-tags > :first-child { flex: 1; }
/* Name + leading slot — swatch aligns to the bottom (= input bottom)
 * so the "Name" label above the input is not stretched over the
 * swatch as well. */
.identity-name-row {
  display: flex;
  align-items: flex-end;
  gap: var(--wp-space-4);
}
.identity-name-row__field { flex: 1; min-width: 0; }
.identity-tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--wp-space-3);
  margin-top: var(--wp-space-3);
}
</style>
