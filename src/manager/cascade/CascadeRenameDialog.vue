<script setup lang="ts">
import { ref, watch, computed } from "vue";
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
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="wp-cascade-dialog__backdrop" @click="emit('cancelled')">
      <div class="wp-cascade-dialog" @click.stop>
        <header>
          <h3>Rename</h3>
        </header>
        <section v-if="loading">
          <p>Scanning impact…</p>
        </section>
        <section v-else>
          <label class="wp-cascade-rename__name-field">
            <span>New name:</span>
            <input v-model="newName" type="text" />
          </label>
          <p v-if="error" class="wp-cascade-dialog__error">⚠ {{ error }}</p>
          <label v-if="affected.length > 0" class="wp-cascade-rename__toggle">
            <input v-model="cascadeRefs" type="checkbox" />
            Update {{ affected.length }}
            {{ affected.length === 1 ? "ref" : "refs" }}
            to new name (recommended)
          </label>
          <ul v-if="affected.length > 0" class="wp-cascade-rename__affected">
            <li v-for="a in affected" :key="a.id">
              <span class="wp-kind-chip">{{ a.kind }}</span>
              {{ a.name }}
            </li>
          </ul>
        </section>
        <footer>
          <button @click="emit('cancelled')">Cancel</button>
          <button
            data-test="cascade-rename-confirm"
            :disabled="!canConfirm"
            @click="onConfirm"
          >
            Rename
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
@layer wp-extension {
  .wp-cascade-dialog__backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .wp-cascade-dialog {
    background: var(--wp-color-surface-1, #1a1a1a);
    border: 1px solid var(--wp-color-border, #333);
    border-radius: 8px;
    min-width: 420px;
    max-width: 600px;
    padding: 0;
  }

  .wp-cascade-dialog header {
    padding: 12px 16px;
    border-bottom: 1px solid var(--wp-color-border, #333);
  }

  .wp-cascade-dialog header h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 500;
  }

  .wp-cascade-dialog section {
    padding: 16px;
  }

  .wp-cascade-dialog footer {
    padding: 12px 16px;
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    border-top: 1px solid var(--wp-color-border, #333);
  }

  .wp-cascade-dialog footer button {
    padding: 6px 12px;
    border: 1px solid var(--wp-color-border, #333);
    border-radius: 4px;
    background: var(--wp-color-surface-2, #2a2a2a);
    color: inherit;
    cursor: pointer;
    font-size: 13px;
  }

  .wp-cascade-dialog footer button:hover:not(:disabled) {
    background: var(--wp-color-surface-3, #3a3a3a);
  }

  .wp-cascade-dialog footer button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .wp-cascade-dialog__error {
    color: var(--wp-color-error-fg, #ef4444);
    margin: 0 0 8px 0;
  }

  .wp-cascade-rename__name-field {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 12px;
  }

  .wp-cascade-rename__name-field input {
    flex: 1;
    padding: 4px 8px;
    background: var(--wp-color-surface-2, #2a2a2a);
    border: 1px solid var(--wp-color-border, #333);
    color: inherit;
  }

  .wp-cascade-rename__toggle {
    display: block;
    margin-top: 12px;
    font-size: 13px;
    cursor: pointer;
    user-select: none;
  }

  .wp-cascade-rename__toggle input {
    margin-right: 6px;
  }

  .wp-cascade-rename__affected {
    margin: 12px 0 0;
    padding-left: 20px;
    font-size: 12px;
  }

  .wp-kind-chip {
    background: var(--wp-color-surface-2, #2a2a2a);
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
    margin-right: 6px;
    display: inline-block;
  }
}
</style>
