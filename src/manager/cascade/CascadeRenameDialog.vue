<script setup lang="ts">
import { computed, ref, watch } from "vue";

import Button from "../components/ui/Button.vue";
import Input from "../components/ui/Input.vue";
import Modal from "../components/ui/Modal.vue";
import { useCascadeApply, type CascadeApplyRequest } from "./useCascadeApply";

interface Props {
  open: boolean;
  kind: string;
  id: string;
  extra?: Record<string, unknown>;
  initialName?: string;
}
const props = withDefaults(defineProps<Props>(), { initialName: "" });

const emit = defineEmits<{
  (e: "confirmed", result: {
    undo_entry_id: string;
    new_name: string;
    broken_refs?: Array<{ kind: string; id: string; name: string }>;
  }): void;
  (e: "cancelled"): void;
}>();

const m = useCascadeApply();
const newName = ref<string>(props.initialName);
const cascadeRefs = ref<boolean>(true);
const affected = ref<Array<{ kind: string; id: string; name: string }>>([]);
const loading = ref(true);
const error = ref<string>("");

async function refreshDryRun(): Promise<void> {
  loading.value = true;
  error.value = "";
  affected.value = [];
  const req: CascadeApplyRequest = {
    kind: props.kind,
    id: props.id,
    action: "rename",
    cascade_refs: true,
    new_name: newName.value,
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
      newName.value = props.initialName ?? "";
      cascadeRefs.value = true;
      await refreshDryRun();
    }
  },
  { immediate: true },
);

const canConfirm = computed<boolean>(() => !!newName.value && !loading.value);

async function onConfirm(): Promise<void> {
  const req: CascadeApplyRequest = {
    kind: props.kind,
    id: props.id,
    action: "rename",
    cascade_refs: cascadeRefs.value,
    new_name: newName.value,
    extra: props.extra,
  };
  const result = await m.apply(req);
  if (result.ok) {
    emit("confirmed", {
      undo_entry_id: result.undo_entry_id,
      new_name: newName.value,
      broken_refs: result.broken_refs,
    });
  } else {
    error.value = result.error ?? "Rename failed";
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
    title="Rename"
    size="sm"
    @update:open="onOpenUpdate"
  >
    <div v-if="loading" class="wp-cascade-rename__body">
      <p>Scanning impact…</p>
    </div>
    <div v-else class="wp-cascade-rename__body">
      <label class="wp-cascade-rename__field">
        <span class="wp-cascade-rename__label">New name</span>
        <Input v-model="newName" type="text" aria-label="New name" />
      </label>
      <p v-if="error" class="wp-cascade-rename__error">⚠ {{ error }}</p>
      <label v-if="affected.length > 0" class="wp-cascade-rename__toggle">
        <input v-model="cascadeRefs" type="checkbox" />
        <span>
          Update <strong>{{ affected.length }}</strong>
          {{ affected.length === 1 ? "ref" : "refs" }}
          to new name <span class="wp-dim">(recommended)</span>
        </span>
      </label>
      <ul v-if="affected.length > 0" class="wp-cascade-rename__affected">
        <li v-for="a in affected" :key="a.id">
          <span class="wp-pill wp-pill--muted">{{ a.kind }}</span>
          <span class="wp-cascade-rename__name">{{ a.name }}</span>
        </li>
      </ul>
    </div>
    <template #footer>
      <Button variant="ghost" size="sm" @click="onCancel">Cancel</Button>
      <Button
        variant="primary"
        size="sm"
        :disabled="!canConfirm"
        data-test="cascade-rename-confirm"
        @click="onConfirm"
      >
        Rename
      </Button>
    </template>
  </Modal>
</template>

<style scoped>
@layer wp-extension {
  .wp-cascade-rename__body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .wp-cascade-rename__body p {
    margin: 0;
  }
  .wp-cascade-rename__field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .wp-cascade-rename__label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--wp-color-text-secondary, #aaa);
  }
  .wp-cascade-rename__toggle {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 13px;
    cursor: pointer;
  }
  .wp-cascade-rename__toggle input[type="checkbox"] {
    margin-top: 3px;
  }
  .wp-cascade-rename__toggle strong {
    font-weight: 600;
  }
  .wp-cascade-rename__affected {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .wp-cascade-rename__affected li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .wp-cascade-rename__name {
    font-weight: 500;
  }
  .wp-cascade-rename__error {
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
  .wp-dim {
    opacity: 0.7;
  }
}
</style>
