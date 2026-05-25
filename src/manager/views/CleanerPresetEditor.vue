<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import Button from "../components/ui/Button.vue";
import Card from "../components/ui/Card.vue";
import Field from "../components/ui/Field.vue";
import Input from "../components/ui/Input.vue";
import Textarea from "../components/ui/Textarea.vue";
import CleanerWidget from "../../components/cleaner/CleanerWidget.vue";
import BlocklistModal from "../../components/cleaner/BlocklistModal.vue";
import { useCleanerPresetStore } from "../stores/cleanerPresetStore";
import { useToast } from "../composables/useToast";
import type {
  CleanerPreset,
  CleanerPresetPayload,
} from "../api/types";

const props = defineProps<{ id: string }>();
const store = useCleanerPresetStore();
const router = useRouter();
const toast = useToast();

const preset = ref<CleanerPreset | null>(null);
const draft = ref<{
  name: string;
  description: string;
  tags: string[];
  payload: CleanerPresetPayload;
} | null>(null);
const blocklistOpen = ref(false);
const saving = ref(false);

const isReadonly = computed(() => preset.value?.is_builtin === true);

onMounted(async () => {
  if (store.items.length === 0) await store.fetchAll();
  const row = store.findById(props.id);
  if (!row) {
    router.replace("/cleaner-presets");
    return;
  }
  preset.value = row;
  draft.value = {
    name: row.name,
    description: row.description,
    tags: [...row.tags],
    payload: JSON.parse(JSON.stringify(row.payload)),
  };
});

async function onSave(): Promise<void> {
  if (!draft.value || !preset.value || isReadonly.value) return;
  saving.value = true;
  try {
    await store.update(preset.value.id, draft.value, { ifMatch: preset.value.version });
    toast.push({ severity: "success", summary: "Saved", life: 2000 });
    router.push("/cleaner-presets");
  } catch (e) {
    toast.push({
      severity: "error",
      summary: "Save failed",
      detail: String(e),
      life: 4000,
    });
  } finally {
    saving.value = false;
  }
}

function onCancel(): void {
  router.push("/cleaner-presets");
}

function onUpdatePayload(next: CleanerPresetPayload): void {
  if (!draft.value) return;
  draft.value.payload = next;
}

function onUpdateBlocklist(next: { kind: "list" | "regex"; entries: string[] }): void {
  if (!draft.value) return;
  draft.value.payload = { ...draft.value.payload, blocklist: next };
}
</script>

<template>
  <div class="wp-route-root">
  <div v-if="draft" class="wp-page wp-page--fill">
    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">
          {{ isReadonly ? draft.name : "Edit preset" }}
        </h1>
        <p v-if="isReadonly" class="wp-page__subtitle">
          Built-in intensity preset — read-only. Clone via the Save button on the canvas widget.
        </p>
        <p v-else class="wp-page__subtitle">
          Tune intensity, rules, and blocklist for this cleaner preset.
        </p>
      </div>
      <div class="wp-page__actions">
        <Button variant="ghost" @click="onCancel">Cancel</Button>
        <Button
          variant="primary"
          :disabled="isReadonly || saving"
          :loading="saving"
          @click="onSave"
        >{{ saving ? "Saving…" : "Save" }}</Button>
      </div>
    </div>

    <Card title="Identity">
      <div class="wp-cleaner-editor__grid">
        <Field label="Name" class="wp-cleaner-editor__field-name">
          <Input
            v-model="draft.name"
            data-test="preset-name"
            placeholder="Preset name"
            :disabled="isReadonly"
            aria-label="Preset name"
          />
        </Field>
        <Field label="Description" class="wp-cleaner-editor__field-desc">
          <Textarea
            v-model="draft.description"
            data-test="preset-description"
            placeholder="What this preset is for"
            :disabled="isReadonly"
            aria-label="Preset description"
            :rows="2"
          />
        </Field>
      </div>
    </Card>

    <Card title="Configuration">
      <div class="wp-cleaner-editor__widget">
        <CleanerWidget
          :model-value="draft.payload"
          :last-run-report="null"
          :word-count="0"
          :char-count="0"
          :clip-token-count="null"
          :clip-token-limit="77"
          :presets="[]"
          @update:model-value="onUpdatePayload"
          @open-blocklist="blocklistOpen = true"
        />
      </div>
    </Card>

    <BlocklistModal
      :visible="blocklistOpen"
      :model-value="draft.payload.blocklist"
      @update:model-value="onUpdateBlocklist"
      @close="blocklistOpen = false"
    />
  </div>
  </div>
</template>

<style scoped>
.wp-route-root { display: contents; }

.wp-cleaner-editor__grid {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: var(--wp-space-4);
}
.wp-cleaner-editor__widget {
  max-width: 460px;
  margin: 0 auto;
}

@media (max-width: 720px) {
  .wp-cleaner-editor__grid { grid-template-columns: 1fr; }
}
</style>
