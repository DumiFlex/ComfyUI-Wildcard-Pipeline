<script setup lang="ts">
/**
 * Settings › Library & data › Backups.
 *
 * Automatic backups (before each migration and once a day, server side, see
 * `engine/db/backups.py`) plus a manual "Back up now". Restore is staged, not
 * immediate: the database is open while ComfyUI runs, so the swap happens on
 * the next start, before anything opens it — the same path a location move
 * takes. The current database is backed up first, so a restore can itself be
 * undone.
 */
import { computed, onMounted, ref } from "vue";
import Toggle from "../ui/Toggle.vue";
import Button from "../ui/Button.vue";
import Select from "../ui/Select.vue";
import Icon from "../ui/Icon.vue";
import type { SelectOption } from "../ui/select-types";
import ConfirmDialog from "../../../components/shared/ConfirmDialog.vue";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";
import { api } from "../../api/client";
import type { BackupEntry, BackupList, BackupReason } from "../../api/types";
import { useServerSettings } from "../../composables/useServerSettings";
import { useSystemStore } from "../../stores/systemStore";
import { useToast } from "../../composables/useToast";

const server = useServerSettings();
const system = useSystemStore();
const toast = useToast();

const list = ref<BackupList | null>(null);
const loadError = ref<string | null>(null);
const creating = ref(false);
const busyName = ref<string | null>(null);
const confirmRestore = ref<BackupEntry | null>(null);
const confirmDelete = ref<BackupEntry | null>(null);
const showAll = ref(false);

const KEEP_OPTIONS: SelectOption[] = [3, 5, 7, 14, 30].map((n) => ({ value: n, label: `Last ${n}` }));

const REASON_LABEL: Record<BackupReason, string> = {
  manual: "Manual",
  daily: "Daily",
  "pre-migration": "Before update",
  "pre-restore": "Before restore",
};

const backups = computed(() => list.value?.backups ?? []);
const shown = computed(() => (showAll.value ? backups.value : backups.value.slice(0, 5)));
const enabled = computed(() => server.settings.value?.backups.enabled ?? true);

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

async function load(): Promise<void> {
  try {
    list.value = await api.database.backups();
    loadError.value = null;
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : "Could not list backups";
  }
}

async function backupNow(): Promise<void> {
  creating.value = true;
  try {
    const entry = await api.database.createBackup();
    await load();
    toast.push({ severity: "success", summary: "Backup saved", detail: entry.name, life: 3000 });
  } catch (err) {
    toast.push({
      severity: "error",
      summary: "Could not back up the database",
      detail: err instanceof Error ? err.message : undefined,
      life: 5000,
    });
  } finally {
    creating.value = false;
  }
}

async function doRestore(): Promise<void> {
  const target = confirmRestore.value;
  confirmRestore.value = null;
  if (!target) return;
  busyName.value = target.name;
  try {
    await api.database.stageRestore(target.name);
    await load();
    toast.push({
      severity: "success",
      summary: "Restore staged",
      detail: "Restart ComfyUI to swap the database. The current one is backed up first.",
      life: 6000,
    });
  } catch (err) {
    toast.push({
      severity: "error",
      summary: "Could not stage the restore",
      detail: err instanceof Error ? err.message : undefined,
      life: 5000,
    });
  } finally {
    busyName.value = null;
  }
}

async function cancelRestore(): Promise<void> {
  try {
    await api.database.cancelRestore();
    await load();
    toast.push({ severity: "info", summary: "Restore cancelled", life: 3000 });
  } catch (err) {
    toast.push({
      severity: "error",
      summary: "Could not cancel the restore",
      detail: err instanceof Error ? err.message : undefined,
      life: 5000,
    });
  }
}

async function doDelete(): Promise<void> {
  const target = confirmDelete.value;
  confirmDelete.value = null;
  if (!target) return;
  busyName.value = target.name;
  try {
    await api.database.deleteBackup(target.name);
    await load();
  } catch (err) {
    toast.push({
      severity: "error",
      summary: "Could not delete the backup",
      detail: err instanceof Error ? err.message : undefined,
      life: 5000,
    });
  } finally {
    busyName.value = null;
  }
}

async function setBackups(patch: { enabled?: boolean; keep?: number; daily?: boolean }): Promise<void> {
  try {
    await server.update({ backups: patch });
  } catch {
    toast.push({ severity: "error", summary: "Could not save the backup setting", life: 4000 });
  }
}

onMounted(() => {
  void load();
  void system.detectRestartCapability();
});
</script>

<template>
  <SettingGroup title="Backups">
    <div v-if="list?.pending_restore" class="wp-bk__pending" role="status" data-test="backup-pending-restore">
      <Icon name="pi-history" />
      <span>
        <strong>{{ list.pending_restore }}</strong> replaces the database on the next ComfyUI start.
      </span>
      <Button variant="ghost" size="sm" data-test="backup-cancel-restore" @click="cancelRestore">Cancel</Button>
      <Button
        v-if="system.canRestart"
        variant="primary"
        size="sm"
        icon="pi-power-off"
        :loading="system.restarting"
        data-test="backup-restart"
        @click="system.restart()"
      >Restart now</Button>
    </div>
    <SettingRow
      label="Automatic backups"
      hint="Copy the database before every update that changes its schema, and once a day while ComfyUI runs."
      setting-key="backups-auto"
    >
      <Toggle
        :model-value="enabled"
        aria-label="Automatic backups"
        :disabled="!server.settings.value"
        data-test="backups-enabled"
        @update:model-value="setBackups({ enabled: $event })"
      />
    </SettingRow>
    <SettingRow
      v-if="enabled"
      label="Daily backup"
      hint="Off keeps only the backups taken before updates."
    >
      <Toggle
        :model-value="server.settings.value?.backups.daily ?? true"
        aria-label="Daily backup"
        :disabled="!server.settings.value"
        data-test="backups-daily"
        @update:model-value="setBackups({ daily: $event })"
      />
    </SettingRow>
    <SettingRow
      v-if="enabled"
      label="Backups to keep"
      hint="Older automatic backups are deleted. Backups you make yourself are never deleted for you."
      setting-key="backups-keep"
    >
      <Select
        :model-value="server.settings.value?.backups.keep ?? 7"
        :options="KEEP_OPTIONS"
        :filterable="false"
        aria-label="Backups to keep"
        data-test="backups-keep"
        @update:model-value="(v) => setBackups({ keep: Number(v) })"
      />
    </SettingRow>
    <SettingRow label="Backups" setting-key="backups-list" stacked>
      <template #extra>
        <p class="wp-bk__dir wp-mono">{{ list?.dir ?? "…" }}</p>
      </template>
      <div class="wp-bk__toolbar">
        <Button variant="secondary" icon="pi-save" :loading="creating" data-test="backup-now" @click="backupNow">
          Back up now
        </Button>
      </div>
      <p v-if="loadError" class="wp-set-error" role="alert">{{ loadError }}</p>
      <p v-else-if="list && backups.length === 0" class="wp-bk__empty" data-test="backup-empty">
        No backups yet. The first one is made today, or before the next update.
      </p>
      <ul v-else class="wp-bk__list" data-test="backup-list">
        <li v-for="b in shown" :key="b.name" class="wp-bk__item" :data-pending="list?.pending_restore === b.name || undefined">
          <div class="wp-bk__meta">
            <span class="wp-bk__when">{{ formatWhen(b.created_at) }}</span>
            <span class="wp-set-pill">{{ REASON_LABEL[b.reason] ?? b.reason }}</span>
            <span class="wp-bk__size">{{ formatBytes(b.size) }}</span>
          </div>
          <div class="wp-bk__actions">
            <Button
              variant="ghost"
              size="sm"
              :loading="busyName === b.name"
              :disabled="list?.pending_restore === b.name"
              :data-test="`backup-restore-${b.name}`"
              @click="confirmRestore = b"
            >{{ list?.pending_restore === b.name ? "Staged" : "Restore" }}</Button>
            <Button
              variant="ghost"
              size="sm"
              icon="pi-trash"
              :aria-label="`Delete backup from ${formatWhen(b.created_at)}`"
              :data-test="`backup-delete-${b.name}`"
              @click="confirmDelete = b"
            />
          </div>
        </li>
      </ul>
      <Button v-if="backups.length > 5" variant="link" size="sm" data-test="backup-show-all" @click="showAll = !showAll">
        {{ showAll ? "Show fewer" : `Show all ${backups.length}` }}
      </Button>
    </SettingRow>

    <ConfirmDialog
      :visible="!!confirmRestore"
      title="Restore this backup?"
      :body="confirmRestore ? `Your library goes back to how it was on ${formatWhen(confirmRestore.created_at)}. This happens the next time ComfyUI starts. The current database is backed up first, so you can undo it the same way.` : ''"
      confirm-label="Stage restore"
      @confirm="doRestore"
      @cancel="confirmRestore = null"
    />
    <ConfirmDialog
      :visible="!!confirmDelete"
      title="Delete this backup?"
      :body="confirmDelete ? `The backup from ${formatWhen(confirmDelete.created_at)} is removed from disk.` : ''"
      confirm-label="Delete"
      variant="danger"
      @confirm="doDelete"
      @cancel="confirmDelete = null"
    />
  </SettingGroup>
</template>

<style scoped>
.wp-bk__pending {
  display: flex;
  align-items: center;
  gap: var(--wp-space-4);
  padding: var(--wp-space-4) var(--wp-space-6);
  border-bottom: 1px solid var(--wp-border);
  background: color-mix(in oklab, var(--wp-warn) 12%, transparent);
  font-size: var(--wp-text-sm);
}
.wp-bk__pending span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.wp-bk__dir { margin: 3px 0 0; font-size: 11px; color: var(--wp-text-dim); overflow-wrap: anywhere; }
.wp-bk__toolbar { display: flex; gap: var(--wp-space-3); }
.wp-bk__empty { margin: 0; font-size: 12px; color: var(--wp-text-dim); }
.wp-bk__list { list-style: none; margin: 0; padding: 0; width: 100%; border: 1px solid var(--wp-border); border-radius: var(--wp-radius); }
.wp-bk__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--wp-space-4);
  padding: 6px var(--wp-space-4);
  border-top: 1px solid var(--wp-border);
}
.wp-bk__item:first-child { border-top: 0; }
.wp-bk__item[data-pending] { background: color-mix(in oklab, var(--wp-warn) 10%, transparent); }
.wp-bk__meta { display: flex; align-items: center; gap: var(--wp-space-4); min-width: 0; font-size: var(--wp-text-sm); }
.wp-bk__when { color: var(--wp-text); white-space: nowrap; }
.wp-bk__size { color: var(--wp-text-dim); font-size: 12px; }
.wp-bk__actions { display: flex; gap: 2px; }
</style>
