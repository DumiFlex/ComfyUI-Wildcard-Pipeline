<script setup lang="ts">
import { ref, watch } from "vue";
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
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="wp-cascade-dialog__backdrop" @click="emit('cancelled')">
      <div class="wp-cascade-dialog" @click.stop>
        <header>
          <h3>{{ action === "delete" ? "Confirm delete" : "Confirm rename" }}</h3>
        </header>
        <section v-if="loading">
          <p>Scanning impact…</p>
        </section>
        <section v-else-if="error">
          <p class="wp-cascade-dialog__error">⚠ {{ error }}</p>
        </section>
        <section v-else>
          <p v-if="affected.length === 0">No downstream refs — safe to proceed.</p>
          <p v-else>
            This will also affect
            {{ affected.length }}
            {{ affected.length === 1 ? "entity" : "entities" }}:
          </p>
          <ul v-if="affected.length > 0">
            <li v-for="a in affected" :key="a.id">
              <span class="wp-kind-chip">{{ a.kind }}</span>
              {{ a.name }}
            </li>
          </ul>
        </section>
        <footer>
          <button @click="emit('cancelled')">Cancel</button>
          <button
            data-test="cascade-confirm"
            :disabled="loading"
            @click="onConfirm"
          >
            {{ action === "delete" ? "Delete + clean up" : "Rename + update refs" }}
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

  .wp-cascade-dialog section p {
    margin: 0 0 8px 0;
  }

  .wp-cascade-dialog section ul {
    margin: 0;
    padding-left: 0;
    list-style: none;
  }

  .wp-cascade-dialog section li {
    padding: 4px 0;
    font-size: 13px;
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
    margin: 0 !important;
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
