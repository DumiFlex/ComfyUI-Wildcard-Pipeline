<script setup lang="ts">
/**
 * Settings › Library & data › Backups.
 *
 * Automatic backups (before each migration and once a day, server side, see
 * `engine/db/backups.py`) plus a manual "Back up now". Restore runs at once,
 * no restart: the server copies the backup into the open library through
 * SQLite's backup API (`restore_now`), after saving the library as it was as
 * a "Before restore" backup, so the toast's Undo restores that one. Then the
 * library pages refetch (`markLibraryChanged`); the canvas picks the change
 * up through its drift poll. A restore an older version staged for the next
 * start still shows its banner and can be cancelled.
 *
 * "Backups to keep" keeps the newest unpinned backups of every kind, manual
 * included; a pinned one (bookmark button) is never pruned and doesn't count.
 * Pruning runs when a backup is made, so an unpinned row past the limit is
 * marked and goes at the next backup rather than the moment it's unpinned.
 */
import { computed, onMounted, ref } from "vue";
import WpSwitch from "@/kit/WpSwitch.vue";
import Button from "@/kit/Button.vue";
import Select from "@/kit/Select.vue";
import Icon, { ICON_SM } from "@/kit/Icon.vue";
import Input from "@/kit/Input.vue";
import Skeleton from "@/kit/Skeleton.vue";
import type { SelectOption } from "@/kit/select-types";
import ConfirmModal from "@/kit/ConfirmModal.vue";
import SettingGroup from "@/kit/SettingGroup.vue";
import SettingRow from "./SettingRow.vue";
import { api } from "../../api/client";
import type { BackupEntry, BackupList, BackupReason } from "../../api/types";
import { useServerSettings } from "../../composables/useServerSettings";
import { useSystemStore } from "../../stores/systemStore";
import { useDatabaseStore } from "../../stores/databaseStore";
import { useToast } from "@/kit/useToast";
import { markLibraryChanged } from "../../composables/useLibraryChanged";

const server = useServerSettings();
const system = useSystemStore();
const database = useDatabaseStore();
const toast = useToast();

const list = ref<BackupList | null>(null);
const loadError = ref<string | null>(null);
const creating = ref(false);
/** Optional short label for the next "Back up now", shown instead of "Manual". */
const note = ref("");
const NOTE_MAX = 80;
const busyName = ref<string | null>(null);
/** The backup being restored; every Restore button waits for it. */
const restoring = ref<string | null>(null);
const pinning = ref<string | null>(null);
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
const keep = computed(() => server.settings.value?.backups.keep ?? 7);
const pinnedCount = computed(() => backups.value.filter((b) => b.pinned).length);
/** Unpinned backups past the keep limit: the next backup prunes them. */
const leaving = computed(() => {
  const out = new Set<string>();
  let kept = 0;
  for (const b of backups.value) {
    if (b.pinned || b.name === list.value?.pending_restore) continue;
    kept += 1;
    if (kept > keep.value) out.add(b.name);
  }
  return out;
});
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
  if (creating.value) return;
  creating.value = true;
  try {
    const entry = await api.database.createBackup(note.value);
    note.value = "";
    await load();
    const removed = entry.pruned.length;
    toast.push({
      severity: "success",
      summary: "Backup saved",
      detail: [entry.note ?? entry.name, removed ? `${removed} older ${removed === 1 ? "backup" : "backups"} removed.` : ""]
        .filter(Boolean).join(". "),
      life: 3000,
    });
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
  await restore(target.name, `Your library is back to ${formatWhen(target.created_at)}.`);
}

/** Restore `name` now. The toast's Undo restores the backup the server
 *  made of the library just before, so an undo can itself be undone. */
async function restore(name: string, detail: string): Promise<void> {
  if (restoring.value) return;
  restoring.value = name;
  try {
    const out = await api.database.restoreBackup(name);
    markLibraryChanged();
    // The Database card above shows the file's size and row counts.
    void database.fetchInfo();
    await load();
    toast.push({
      severity: "success",
      summary: "Backup restored",
      detail: `${detail} The library as it was is saved as a "Before restore" backup.`,
      life: 8000,
      action: {
        label: "Undo",
        run: () => restore(out.pre_restore, "Your library is back to how it was before the restore."),
      },
    });
  } catch (err) {
    toast.push({
      severity: "error",
      summary: "Could not restore the backup",
      detail: err instanceof Error ? err.message : undefined,
      life: 8000,
    });
  } finally {
    restoring.value = null;
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

async function togglePin(b: BackupEntry): Promise<void> {
  pinning.value = b.name;
  try {
    await api.database.pinBackup(b.name, !b.pinned);
    await load();
  } catch (err) {
    toast.push({
      severity: "error",
      summary: b.pinned ? "Could not unpin the backup" : "Could not pin the backup",
      detail: err instanceof Error ? err.message : undefined,
      life: 5000,
    });
  } finally {
    pinning.value = null;
  }
}

function deleteBody(b: BackupEntry): string {
  const base = `The backup from ${formatWhen(b.created_at)} is removed from disk.`;
  return b.pinned ? `${base} It is pinned, so it would never have been removed for you.` : base;
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
        <strong>{{ list.pending_restore }}</strong> replaces the database on the next ComfyUI start. Cancel it to restore it right away instead.
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
      <WpSwitch
        size="md"
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
      <WpSwitch
        size="md"
        :model-value="server.settings.value?.backups.daily ?? true"
        aria-label="Daily backup"
        :disabled="!server.settings.value"
        data-test="backups-daily"
        @update:model-value="setBackups({ daily: $event })"
      />
    </SettingRow>
    <SettingRow
      label="Backups to keep"
      hint="The newest backups are kept and older ones are deleted, the ones you make yourself included. Pin a backup to keep it for good; pinned ones don't count."
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
        <p v-if="list || loadError" class="wp-bk__dir wp-mono">{{ list?.dir ?? "…" }}</p>
        <Skeleton v-else width="24ch" class="wp-bk__dir" />
      </template>
      <div class="wp-bk__toolbar">
        <Input
          v-model="note"
          class="wp-bk__note"
          placeholder="Note (optional), e.g. before the outfit rework"
          aria-label="Note for this backup"
          :maxlength="NOTE_MAX"
          data-test="backup-note"
          @keydown.enter="backupNow"
        />
        <Button variant="secondary" icon="pi-save" :loading="creating" data-test="backup-now" @click="backupNow">
          Back up now
        </Button>
        <span v-if="pinnedCount" class="wp-bk__count" data-test="backup-pinned-count">
          <Icon name="pi-bookmark-fill" :size="ICON_SM" /> {{ pinnedCount }} pinned
        </span>
      </div>
      <p v-if="loadError" class="wp-set-error" role="alert">{{ loadError }}</p>
      <Skeleton
        v-else-if="!list"
        shape="row"
        icon="square"
        :lines="3"
        label="Loading backups"
        data-test="backup-skeleton"
      />
      <p v-else-if="backups.length === 0" class="wp-bk__empty" data-test="backup-empty">
        No backups yet. The first one is made today, or before the next update.
      </p>
      <ul v-else class="wp-bk__list" data-test="backup-list">
        <li v-for="b in shown" :key="b.name" class="wp-bk__item" :data-pending="list?.pending_restore === b.name || undefined">
          <div class="wp-bk__meta">
            <span class="wp-bk__when">{{ formatWhen(b.created_at) }}</span>
            <span
              class="wp-set-pill"
              :data-note="b.note ? true : undefined"
              :title="b.note ? `${REASON_LABEL[b.reason] ?? b.reason} backup: ${b.note}` : undefined"
              :data-test="`backup-label-${b.name}`"
            >{{ b.note ?? REASON_LABEL[b.reason] ?? b.reason }}</span>
            <span class="wp-bk__size">{{ formatBytes(b.size) }}</span>
            <span
              v-if="leaving.has(b.name)"
              class="wp-set-pill"
              data-tone="warn"
              title="Past the number of backups to keep. Pin it to keep it."
              :data-test="`backup-leaving-${b.name}`"
            >Removed at next backup</span>
          </div>
          <div class="wp-bk__actions">
            <Button
              variant="ghost"
              size="sm"
              :icon="b.pinned ? 'pi-bookmark-fill' : 'pi-bookmark'"
              :pressed="b.pinned"
              :disabled="pinning === b.name"
              :aria-label="`${b.pinned ? 'Unpin' : 'Pin'} backup from ${formatWhen(b.created_at)}`"
              :title="b.pinned ? 'Pinned: never removed for you. Click to unpin.' : 'Pin: keep this backup for good'"
              :data-test="`backup-pin-${b.name}`"
              @click="togglePin(b)"
            />
            <Button
              variant="ghost"
              size="sm"
              :loading="restoring === b.name"
              :disabled="(!!restoring && restoring !== b.name) || list?.pending_restore === b.name"
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

    <ConfirmModal
      :open="!!confirmRestore"
      title="Restore this backup?"
      :body="confirmRestore ? `Your library goes back to how it was on ${formatWhen(confirmRestore.created_at)}, right away, with no restart. The current library is backed up first, so you can undo it.` : ''"
      confirm-label="Restore"
      @confirm="doRestore"
      @cancel="confirmRestore = null"
    />
    <ConfirmModal
      :open="!!confirmDelete"
      title="Delete this backup?"
      :body="confirmDelete ? deleteBody(confirmDelete) : ''"
      confirm-label="Delete"
      tone="danger"
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
.wp-bk__toolbar { display: flex; align-items: center; gap: var(--wp-space-4); }
.wp-bk__note { width: 320px; max-width: 100%; }
.wp-bk__meta .wp-set-pill[data-note] { max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--wp-text); }
.wp-bk__count { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--wp-text-dim); }
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
