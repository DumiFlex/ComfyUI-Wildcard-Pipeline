<script setup lang="ts">
import type { ModuleEntry } from "../../../../widgets/_shared";
import { refreshModule, setLibraryHash } from "../../drift-store";
import { pushToast } from "../../../shared/toast-store";

type ModuleKind = ModuleEntry["type"];

const KIND_ROUTE: Record<ModuleKind, string> = {
  wildcard: "wildcards",
  fixed_values: "fixed-values",
  combine: "combines",
  derivation: "derivations",
  constraint: "constraints",
  pipeline: "pipelines",
};

const props = defineProps<{
  module: ModuleEntry;
  isLibraryTracked: boolean;
  isDrifted: boolean;
}>();

const emit = defineEmits<{
  "reset-from-library": [refreshed: ModuleEntry];
  "saved-to-library": [];
}>();

function onOpenInSpa(): void {
  const path = `/wp/manager/${KIND_ROUTE[props.module.type]}/${props.module.id}/edit`;
  window.open(path, "_blank", "noopener");
}

async function onResetFromLibrary(): Promise<void> {
  const ok = window.confirm(
    `Discard ${props.module.meta?.name || "this module"}'s local edits and restore from library?`,
  );
  if (!ok) return;
  try {
    const refreshed = await refreshModule(props.module);
    emit("reset-from-library", refreshed);
  } catch (err) {
    pushToast(`Reset failed: ${(err as Error).message}`, { severity: "error" });
  }
}

async function onSaveToLibrary(): Promise<void> {
  const ok = window.confirm(
    `Push current changes to library entry "${props.module.meta?.name}"? ` +
    `Other workflows referencing this module will see the new version on their next open.`,
  );
  if (!ok) return;
  try {
    const res = await fetch(`/wp/api/modules/${props.module.id}/payload`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: props.module.payload, meta: props.module.meta }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json() as { new_hash: string };
    setLibraryHash(props.module.id, body.new_hash);
    emit("saved-to-library");
    pushToast("Saved to library", { severity: "success" });
  } catch (err) {
    pushToast(`Save failed: ${(err as Error).message}`, { severity: "error" });
  }
}
</script>

<template>
  <div v-if="isLibraryTracked" class="wp-lrt-actions">
    <button class="wp-btn" data-test="lrt-open" @click="onOpenInSpa">
      <i class="pi pi-external-link" /> Open in SPA
    </button>
    <button v-if="isDrifted" class="wp-btn" data-test="lrt-reset" @click="onResetFromLibrary">
      <i class="pi pi-replay" /> Reset to library
    </button>
    <button v-if="isDrifted" class="wp-btn wp-btn--primary" data-test="lrt-save" @click="onSaveToLibrary">
      <i class="pi pi-save" /> Save to library
    </button>
  </div>
</template>

<style scoped>
.wp-lrt-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 8px 12px;
  border-top: 1px solid var(--wp-border);
  background: var(--wp-bg2);
}
</style>
