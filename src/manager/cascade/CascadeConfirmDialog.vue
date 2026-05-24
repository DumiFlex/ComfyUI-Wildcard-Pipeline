<script setup lang="ts">
import { computed, ref, watch } from "vue";

import Button from "../components/ui/Button.vue";
import Modal from "../components/ui/Modal.vue";
import { useCascadeApply, type CascadeApplyRequest } from "./useCascadeApply";

interface Props {
  open: boolean;
  kind: string;
  id: string;
  action: "delete" | "rename";
  extra?: Record<string, unknown>;
  newName?: string;
  cascadeRefs?: boolean;
}
const props = withDefaults(defineProps<Props>(), { cascadeRefs: true });

const emit = defineEmits<{
  (e: "confirmed", result: { undo_entry_id: string; affected_count: number }): void;
  (e: "cancelled"): void;
}>();

const m = useCascadeApply();
const loading = ref(true);
const affected = ref<Array<{ kind: string; id: string; name: string }>>([]);
const error = ref<string>("");

const title = computed(() =>
  props.action === "delete" ? "Confirm delete" : "Confirm rename",
);
const confirmLabel = computed(() =>
  props.action === "delete" ? "Delete + clean up" : "Rename + update refs",
);
const confirmVariant = computed<"danger" | "primary">(() =>
  props.action === "delete" ? "danger" : "primary",
);

async function refreshDryRun(): Promise<void> {
  loading.value = true;
  error.value = "";
  affected.value = [];
  const req: CascadeApplyRequest = {
    kind: props.kind,
    id: props.id,
    action: props.action,
    cascade_refs: props.cascadeRefs,
    new_name: props.newName,
    extra: props.extra,
  };
  const result = await m.dryRun(req);
  if (!result.ok) {
    error.value = result.error ?? "Unknown error";
  } else {
    affected.value = result.affected_entities ?? [];
  }
  loading.value = false;
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      await refreshDryRun();
    }
  },
  { immediate: true },
);

async function onConfirm(): Promise<void> {
  const req: CascadeApplyRequest = {
    kind: props.kind,
    id: props.id,
    action: props.action,
    cascade_refs: props.cascadeRefs,
    new_name: props.newName,
    extra: props.extra,
  };
  const result = await m.apply(req);
  if (result.ok) {
    emit("confirmed", {
      undo_entry_id: result.undo_entry_id,
      affected_count: result.affected_count,
    });
  } else {
    error.value = result.error ?? "Apply failed";
  }
}

function onCancel(): void {
  emit("cancelled");
}

function onOpenUpdate(v: boolean): void {
  if (!v) onCancel();
}
</script>

<template>
  <Modal
    :open="open"
    :title="title"
    size="sm"
    @update:open="onOpenUpdate"
  >
    <div v-if="loading" class="wp-cascade-confirm__body">
      <p>Scanning impact…</p>
    </div>
    <div v-else-if="error" class="wp-cascade-confirm__body">
      <p class="wp-cascade-confirm__error">⚠ {{ error }}</p>
    </div>
    <div v-else class="wp-cascade-confirm__body">
      <p v-if="affected.length === 0">No downstream refs — safe to proceed.</p>
      <p v-else class="wp-cascade-confirm__intro">
        This will also affect
        <strong>{{ affected.length }}</strong>
        {{ affected.length === 1 ? "entity" : "entities" }}:
      </p>
      <ul v-if="affected.length > 0" class="wp-cascade-confirm__list">
        <li v-for="a in affected" :key="a.id">
          <span class="wp-pill wp-pill--muted">{{ a.kind }}</span>
          <span class="wp-cascade-confirm__name">{{ a.name }}</span>
        </li>
      </ul>
    </div>
    <template #footer>
      <Button variant="ghost" size="sm" @click="onCancel">Cancel</Button>
      <Button
        :variant="confirmVariant"
        size="sm"
        :disabled="loading"
        data-test="cascade-confirm"
        @click="onConfirm"
      >
        {{ confirmLabel }}
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
@layer wp-extension {
  .wp-cascade-confirm__body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .wp-cascade-confirm__body p {
    margin: 0;
  }
  .wp-cascade-confirm__intro strong {
    font-weight: 600;
  }
  .wp-cascade-confirm__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .wp-cascade-confirm__list li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .wp-cascade-confirm__name {
    font-weight: 500;
  }
  .wp-cascade-confirm__error {
    color: var(--wp-color-error-fg, #ef4444);
  }
  .wp-pill {
    display: inline-flex;
    align-items: center;
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 11px;
    text-transform: lowercase;
    letter-spacing: 0.02em;
  }
  .wp-pill--muted {
    background: var(--wp-color-surface-2, #2a2a2a);
    color: var(--wp-color-text-secondary, #aaa);
  }
}
</style>
