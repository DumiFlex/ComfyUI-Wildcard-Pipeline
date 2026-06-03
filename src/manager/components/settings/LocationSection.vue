<script setup lang="ts">
/**
 * Location subsection of the Database card.
 *
 * Layout:
 *   - Optional pending-move banner at top (when config.pending_move set)
 *   - Optional env-lock notice (when config.env_locked true)
 *   - Radio group: user / global / root
 *   - Apply button: enabled only when selection differs from current
 *
 * Apply flow:
 *   1. User picks a different radio + clicks Apply.
 *   2. We check: does the destination location already have a DB?
 *      (use config.locations[target].exists)
 *   3a. If destination DB exists: show "conflict" modal — choose
 *       "Use existing DB at new location" (no move, just point) or
 *       "Cancel". (Overwriting is dangerous; skip that path for MVP.)
 *   3b. If destination is empty AND current location has a DB:
 *       show "transfer" modal — choose "Copy" / "Move" / "Don't transfer".
 *   3c. If neither has data: just set preference, no pending_move.
 *   4. Send PUT to backend via store.setConfig().
 *   5. Show success toast: "Restart ComfyUI to apply changes."
 */
import { computed, ref, watch } from "vue";
import Button from "../ui/Button.vue";
import Icon from "../ui/Icon.vue";
import Modal from "../ui/Modal.vue";
import { useDatabaseStore } from "../../stores/databaseStore";
import { useSystemStore } from "../../stores/systemStore";
import { useToast } from "../../composables/useToast";
import type { DatabasePreference, MoveMode } from "../../api/types";

const store = useDatabaseStore();
const system = useSystemStore();
const toast = useToast();

interface LocationOption {
  key: DatabasePreference;
  label: string;
  description: string;
}

const LOCATIONS: LocationOption[] = [
  {
    key: "user",
    label: "User (recommended)",
    description: "Per-ComfyUI-instance. Different installs get separate databases.",
  },
  {
    key: "global",
    label: "Global",
    description: "Shared across all ComfyUI installs on this machine.",
  },
  {
    key: "root",
    label: "Root (not recommended)",
    description: "Inside this plugin's directory. Survives ComfyUI reinstalls.",
  },
];

// Current effective preference: explicit pref, or "user" as default.
const currentPref = computed<DatabasePreference>(() => {
  return store.config?.preference ?? "user";
});

// Selection state (radio v-model).
const selected = ref<DatabasePreference>(currentPref.value);

// Re-sync selection when config arrives or changes externally.
function syncSelectionFromConfig(): void {
  selected.value = currentPref.value;
}
// Initial sync if config already present at mount.
syncSelectionFromConfig();

// Watch config for late arrival (mount before fetchConfig resolves).
watch(() => store.config?.preference, () => syncSelectionFromConfig());

const isDirty = computed(() => selected.value !== currentPref.value);

const envLocked = computed(() => store.config?.env_locked ?? false);

const pending = computed(() => store.config?.pending_move ?? null);

// Currently-resolved DB path (from gather_info source field), if we have it.
const currentSourcePath = computed(() => store.info?.path ?? null);

// Modal state ----------------------------------------------------
type ApplyPhase = "transfer" | "conflict" | "saving" | null;
const phase = ref<ApplyPhase>(null);
const transferMode = ref<MoveMode | "none">("copy");

function onApply(): void {
  if (!isDirty.value || envLocked.value) return;
  const target = selected.value;
  const locations = store.config?.locations;
  if (!locations) return;
  const targetEntry = locations[target];
  const sourcePath = currentSourcePath.value;

  // 3a. Destination already has a DB → conflict phase.
  if (targetEntry.exists) {
    phase.value = "conflict";
    return;
  }

  // 3b. Source has data; destination empty → transfer phase.
  if (sourcePath) {
    transferMode.value = "copy";
    phase.value = "transfer";
    return;
  }

  // 3c. Neither has data → just save preference.
  void doApply(null);
}

async function doApply(pendingMove: { from: string; to: string; mode: MoveMode } | null): Promise<void> {
  phase.value = "saving";
  const result = await store.setConfig({
    preference: selected.value,
    pending_move: pendingMove,
  });
  phase.value = null;
  if (result) {
    toast.push({
      severity: "info",
      summary: "Restart required",
      detail: "Database location change takes effect after ComfyUI restart.",
      life: 6000,
    });
  }
}

function confirmTransfer(): void {
  const sourcePath = currentSourcePath.value;
  const target = selected.value;
  const locations = store.config?.locations;
  if (!locations) return;
  const targetPath = locations[target].path;
  if (!sourcePath || !targetPath) return;
  if (transferMode.value === "none") {
    void doApply(null);
  } else {
    void doApply({ from: sourcePath, to: targetPath, mode: transferMode.value });
  }
}

function useExistingAtTarget(): void {
  // Conflict case: don't move anything, just point preference.
  void doApply(null);
}

function closeModal(): void {
  phase.value = null;
  syncSelectionFromConfig();
}

async function onCancelPending(): Promise<void> {
  await store.cancelPendingMove();
}

function fmtBytes(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
</script>

<template>
  <section class="wp-loc">
    <h3 class="wp-loc__title">Location</h3>

    <!-- Pending banner -->
    <div v-if="pending" class="wp-loc__pending" role="status" data-test="location-pending-banner">
      <Icon name="pi-exclamation-triangle" />
      <span>
        Pending: <strong>{{ pending.mode }}</strong>
        <span class="wp-mono">{{ pending.from }}</span>
        &rarr;
        <span class="wp-mono">{{ pending.to }}</span>.
        Restart ComfyUI to apply.
      </span>
      <Button
        v-if="system.canRestart"
        variant="primary"
        size="sm"
        icon="pi-power-off"
        :loading="system.restarting"
        :disabled="store.savingConfig"
        data-test="location-restart-now"
        @click="() => system.restart()"
      >Restart now</Button>
      <Button
        variant="link"
        :disabled="store.savingConfig || system.restarting"
        data-test="location-cancel-pending"
        @click="onCancelPending"
      >Cancel</Button>
    </div>

    <!-- Env-lock notice -->
    <div v-if="envLocked" class="wp-loc__envlock" role="status" data-test="location-env-locked">
      <Icon name="pi-lock" />
      Location is controlled by an environment variable
      (<span class="wp-mono">WP_DB_PATH</span> or <span class="wp-mono">COMFYUI_USER_DIR</span>).
      Unset to manage from this UI.
    </div>

    <!-- Radio group -->
    <fieldset class="wp-loc__group" :disabled="envLocked || store.savingConfig">
      <label
        v-for="opt in LOCATIONS"
        :key="opt.key"
        class="wp-loc__option"
        :class="{ 'wp-loc__option--selected': selected === opt.key }"
        :data-test="`location-option-${opt.key}`"
      >
        <input
          type="radio"
          name="db-location"
          :value="opt.key"
          v-model="selected"
          class="wp-loc__radio"
        />
        <div class="wp-loc__option-body">
          <div class="wp-loc__option-head">
            <span class="wp-loc__option-label">{{ opt.label }}</span>
            <span
              v-if="currentPref === opt.key"
              class="wp-loc__chip wp-loc__chip--current"
            >current</span>
          </div>
          <p class="wp-loc__option-desc">{{ opt.description }}</p>
          <p v-if="store.config?.locations[opt.key].path" class="wp-loc__option-path wp-mono">
            {{ store.config.locations[opt.key].path }}
            <span
              v-if="store.config.locations[opt.key].exists"
              class="wp-loc__chip wp-loc__chip--exists"
            >has data {{ fmtBytes(store.config.locations[opt.key].size_bytes) }}</span>
          </p>
          <p v-else class="wp-loc__option-path wp-loc__option-path--missing">
            Path unavailable (ComfyUI user dir not detected)
          </p>
        </div>
      </label>
    </fieldset>

    <div class="wp-loc__actions">
      <Button
        variant="primary"
        :disabled="!isDirty || envLocked || store.savingConfig"
        :loading="store.savingConfig"
        data-test="location-apply"
        @click="onApply"
      >Apply</Button>
    </div>

    <!-- Transfer modal (source has data, destination empty) -->
    <Modal
      :open="phase === 'transfer'"
      title="Transfer existing database?"
      size="sm"
      @update:open="(v) => { if (!v) closeModal(); }"
    >
      <div class="wp-loc__modal-body">
        <p>
          The current database at <span class="wp-mono">{{ currentSourcePath }}</span>
          will be transferred to the new location.
        </p>
        <div class="wp-loc__modal-choice">
          <label>
            <input type="radio" v-model="transferMode" value="copy" />
            <strong>Copy</strong> &mdash; duplicate to new location, keep current as backup
          </label>
          <label>
            <input type="radio" v-model="transferMode" value="move" />
            <strong>Move</strong> &mdash; relocate file, source removed
          </label>
          <label>
            <input type="radio" v-model="transferMode" value="none" />
            <strong>Don't transfer</strong> &mdash; point at new location, start fresh
          </label>
        </div>
      </div>
      <template #footer>
        <Button variant="ghost" @click="closeModal">Cancel</Button>
        <Button variant="primary" data-test="location-confirm-transfer" @click="confirmTransfer">Apply</Button>
      </template>
    </Modal>

    <!-- Conflict modal (destination already has a DB) -->
    <Modal
      :open="phase === 'conflict'"
      title="Destination already has a database"
      size="sm"
      @update:open="(v) => { if (!v) closeModal(); }"
    >
      <div class="wp-loc__modal-body">
        <p>
          A database file already exists at
          <span class="wp-mono">{{ store.config?.locations[selected].path }}</span>.
        </p>
        <p>
          You can switch to use the existing database at that location.
          Overwriting is not offered here &mdash; back up first if you need to replace it.
        </p>
      </div>
      <template #footer>
        <Button variant="ghost" @click="closeModal">Cancel</Button>
        <Button variant="primary" data-test="location-use-existing" @click="useExistingAtTarget">
          Use existing database
        </Button>
      </template>
    </Modal>
  </section>
</template>

<style scoped>
.wp-loc { margin-bottom: var(--wp-space-6); }
.wp-loc__title {
  font-size: var(--wp-text-sm);
  color: var(--wp-text-muted);
  margin: 0 0 var(--wp-space-4);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.wp-loc__pending {
  display: flex; align-items: center; gap: var(--wp-space-3);
  padding: var(--wp-space-3) var(--wp-space-4);
  border: 1px solid color-mix(in oklab, var(--wp-warn) 40%, transparent);
  border-radius: var(--wp-radius-sm);
  background: color-mix(in oklab, var(--wp-warn) 12%, transparent);
  color: var(--wp-text);
  font-size: var(--wp-text-sm);
  margin-bottom: var(--wp-space-4);
  flex-wrap: wrap;
}
.wp-loc__pending .pi { color: var(--wp-warn); }
.wp-loc__envlock {
  display: flex; align-items: center; gap: var(--wp-space-3);
  padding: var(--wp-space-3) var(--wp-space-4);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  background: var(--wp-bg-2);
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
  margin-bottom: var(--wp-space-4);
}
.wp-loc__group {
  border: none; padding: 0; margin: 0 0 var(--wp-space-4);
  display: flex; flex-direction: column; gap: var(--wp-space-3);
}
.wp-loc__option {
  display: flex; align-items: flex-start; gap: var(--wp-space-4);
  padding: var(--wp-space-4);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  background: var(--wp-bg-2);
  cursor: pointer;
}
.wp-loc__option:hover { border-color: var(--wp-border-strong); }
.wp-loc__option--selected {
  border-color: var(--wp-accent-500);
  background: color-mix(in oklab, var(--wp-accent-500) 8%, transparent);
}
.wp-loc__radio { margin-top: 3px; }
.wp-loc__option-body { flex: 1; min-width: 0; }
.wp-loc__option-head {
  display: flex; align-items: center; gap: var(--wp-space-3);
  margin-bottom: var(--wp-space-1);
}
.wp-loc__option-label { font-weight: 500; font-size: var(--wp-text-md); color: var(--wp-text); }
.wp-loc__option-desc { font-size: var(--wp-text-sm); color: var(--wp-text-dim); margin: 0 0 var(--wp-space-2); }
.wp-loc__option-path { font-size: var(--wp-text-xs); color: var(--wp-text-muted); margin: 0; word-break: break-all; }
.wp-loc__option-path--missing { font-style: italic; }
.wp-loc__chip {
  display: inline-block; padding: 1px 8px;
  border-radius: 999px;
  font-size: var(--wp-text-xs);
  font-family: var(--wp-font);
  font-weight: 500;
}
.wp-loc__chip--current {
  background: color-mix(in oklab, var(--wp-accent-500) 18%, transparent);
  color: var(--wp-accent-text);
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 30%, transparent);
}
.wp-loc__chip--exists {
  background: var(--wp-bg-3);
  color: var(--wp-text-muted);
  border: 1px solid var(--wp-border);
  margin-left: var(--wp-space-3);
}
.wp-loc__actions { display: flex; justify-content: flex-end; }
.wp-loc__modal-body { font-size: var(--wp-text-sm); color: var(--wp-text); line-height: 1.6; }
.wp-loc__modal-body p { margin: 0 0 var(--wp-space-3); }
.wp-loc__modal-choice { display: flex; flex-direction: column; gap: var(--wp-space-3); margin-top: var(--wp-space-3); }
.wp-loc__modal-choice label { display: flex; gap: var(--wp-space-3); align-items: flex-start; cursor: pointer; }
</style>
