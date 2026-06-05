<script setup lang="ts">
/**
 * Database card — read-only info (path/file/counts/schema) + maintenance
 * ops (VACUUM, integrity, ANALYZE, migrate). Each op runs through the
 * three-phase MaintenanceOpModal. While `runningOp` is set, all other
 * op buttons are disabled to prevent concurrent runs.
 */
import { computed, onMounted, ref } from "vue";
import Button from "../ui/Button.vue";
import Card from "../ui/Card.vue";
import Icon from "../ui/Icon.vue";
import LocationSection from "./LocationSection.vue";
import MaintenanceOpModal from "./MaintenanceOpModal.vue";
import ConfirmDialog from "../../../components/shared/ConfirmDialog.vue";
import { useDatabaseStore } from "../../stores/databaseStore";
import { useSystemStore } from "../../stores/systemStore";
import type { MaintenanceOp, MaintenanceResult } from "../../api/types";

interface OpSpec {
  op: MaintenanceOp;
  icon: string;
  name: string;
  desc: string;
  modalTitle: string;
  modalBody: string;
  confirmLabel: string;
}

const OPS: OpSpec[] = [
  {
    op: "vacuum", icon: "pi-refresh", name: "VACUUM",
    desc: "Rebuild file, reclaim freelist space",
    modalTitle: "Run VACUUM?",
    modalBody: "Rebuilds the database file and reclaims unused space. The DB is locked during the operation.",
    confirmLabel: "Run VACUUM",
  },
  {
    op: "integrity", icon: "pi-shield", name: "Integrity check",
    desc: "PRAGMA integrity_check — read-only",
    modalTitle: "Run integrity check?",
    modalBody: "Scans the database for corruption. Read-only; safe to run any time.",
    confirmLabel: "Run check",
  },
  {
    op: "analyze", icon: "pi-chart-bar", name: "ANALYZE",
    desc: "Refresh query planner statistics",
    modalTitle: "Run ANALYZE?",
    modalBody: "Refreshes SQLite's query planner statistics. Improves performance after bulk inserts or deletes.",
    confirmLabel: "Run ANALYZE",
  },
  {
    op: "migrate", icon: "pi-history", name: "Re-run migrations",
    desc: "Force migrate(conn). Idempotent",
    modalTitle: "Re-run migrations?",
    modalBody: "Forces the migration runner to apply any pending schema versions. No-op if the DB is already current.",
    confirmLabel: "Run migrations",
  },
];

const store = useDatabaseStore();
const system = useSystemStore();

const activeSpec = ref<OpSpec | null>(null);
type Phase = "confirm" | "loading" | "result-ok" | "result-error";
const phase = ref<Phase>("confirm");
const lastResult = ref<MaintenanceResult | undefined>(undefined);

const isModalOpen = computed(() => activeSpec.value !== null);

function startOp(spec: OpSpec): void {
  activeSpec.value = spec;
  phase.value = "confirm";
  lastResult.value = undefined;
}

async function confirmOp(): Promise<void> {
  if (!activeSpec.value) return;
  phase.value = "loading";
  const result = await store.runOp(activeSpec.value.op);
  lastResult.value = result;
  phase.value = result.ok ? "result-ok" : "result-error";
}

function closeModal(): void {
  activeSpec.value = null;
  phase.value = "confirm";
  lastResult.value = undefined;
}

function refresh(): void {
  if (store.runningOp) return;
  void store.fetchInfo();
}

// Restart confirm — kicking ComfyUI interrupts running workflows
// and queued prompts, so users should explicitly confirm. Mirrors
// the same gate StaleBanner uses for its Restart pill.
const restartConfirmOpen = ref(false);
function askRestart(): void { restartConfirmOpen.value = true; }
function onRestartConfirmed(): void {
  restartConfirmOpen.value = false;
  void system.restart();
}
function onRestartCancelled(): void {
  restartConfirmOpen.value = false;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

onMounted(() => {
  void store.fetchInfo();
  void store.fetchConfig();
});
</script>

<template>
  <Card title="Database">
    <template #actions>
      <Button
        variant="ghost"
        icon="pi-refresh"
        aria-label="Refresh database info"
        data-test="database-refresh"
        :disabled="!!store.runningOp"
        @click="refresh"
      />
    </template>

    <div v-if="store.lastError" class="wp-db__error" role="alert">
      <Icon name="pi-exclamation-triangle" />
      <span>{{ store.lastError }}</span>
      <Button variant="link" @click="refresh">Retry</Button>
    </div>

    <div v-else-if="store.loading && !store.info" data-test="database-loading" class="wp-db__loading">
      <Icon name="spin pi-spinner" />
      <span>Loading database info…</span>
    </div>

    <div v-else-if="store.info">
      <section class="wp-db__section">
        <h3 class="wp-db__section-title">File</h3>
        <dl class="wp-db__rows">
          <div class="wp-db__row"><dt>Path</dt><dd class="wp-mono">{{ store.info.path }}</dd></div>
          <div class="wp-db__row"><dt>Source</dt><dd><span class="wp-db__chip">{{ store.info.source }}</span></dd></div>
          <div class="wp-db__row"><dt>Size</dt><dd>{{ formatBytes(store.info.size_bytes) }}</dd></div>
          <div class="wp-db__row"><dt>Last modified</dt><dd>{{ formatDate(store.info.mtime_iso) }}</dd></div>
        </dl>
      </section>

      <LocationSection />

      <section class="wp-db__section">
        <h3 class="wp-db__section-title">Row counts</h3>
        <dl class="wp-db__rows wp-db__rows--grid">
          <div class="wp-db__row" v-for="[kind, n] in Object.entries(store.info.counts)" :key="kind">
            <dt>{{ kind }}</dt><dd>{{ n }}</dd>
          </div>
        </dl>
      </section>

      <section class="wp-db__section">
        <h3 class="wp-db__section-title">Schema</h3>
        <dl class="wp-db__rows">
          <div class="wp-db__row"><dt>Migration version</dt><dd>v{{ store.info.migration.current_version }}</dd></div>
          <div class="wp-db__row"><dt>Journal mode</dt><dd>{{ store.info.pragma.journal_mode }}</dd></div>
          <div class="wp-db__row"><dt>Foreign keys</dt><dd>{{ store.info.pragma.foreign_keys ? "on" : "off" }}</dd></div>
          <div class="wp-db__row"><dt>Page size</dt><dd>{{ store.info.pragma.page_size }} B</dd></div>
          <div class="wp-db__row"><dt>Page count</dt><dd>{{ store.info.pragma.page_count }}</dd></div>
          <div class="wp-db__row"><dt>Free pages</dt><dd>{{ store.info.pragma.freelist_count }}</dd></div>
        </dl>
      </section>

      <section class="wp-db__section">
        <h3 class="wp-db__section-title">Maintenance</h3>
        <div class="wp-db__ops">
          <div v-for="spec in OPS" :key="spec.op" class="wp-db__op-row">
            <div class="wp-db__op-info">
              <p class="wp-db__op-name"><Icon :name="spec.icon" />{{ spec.name }}</p>
              <p class="wp-db__op-desc">{{ spec.desc }}</p>
            </div>
            <Button
              :data-test="`database-run-${spec.op}`"
              :disabled="!!store.runningOp"
              :loading="store.runningOp === spec.op"
              @click="startOp(spec)"
            >Run</Button>
          </div>
          <div v-if="system.canRestart" class="wp-db__op-row" data-test="database-restart-row">
            <div class="wp-db__op-info">
              <p class="wp-db__op-name"><Icon name="pi-power-off" />Restart ComfyUI</p>
              <p class="wp-db__op-desc">
                Restart the host process via ComfyUI Manager. Required to apply pending DB moves.
              </p>
            </div>
            <Button
              variant="primary"
              icon="pi-power-off"
              :loading="system.restarting"
              :disabled="!!store.runningOp"
              data-test="database-restart"
              @click="askRestart"
            >Restart</Button>
          </div>
        </div>
      </section>
    </div>

    <MaintenanceOpModal
      v-if="activeSpec"
      :open="isModalOpen"
      :op="activeSpec.op"
      :title="activeSpec.modalTitle"
      :description="activeSpec.modalBody"
      :confirm-label="activeSpec.confirmLabel"
      :phase="phase"
      :result="lastResult"
      @confirm="confirmOp"
      @close="closeModal"
      @update:open="(v) => { if (!v) closeModal(); }"
    />

    <ConfirmDialog
      :visible="restartConfirmOpen"
      title="Restart ComfyUI?"
      body="This kicks the running ComfyUI process. Any in-flight workflows and queued prompts will be interrupted. The page will reload automatically once the server is back."
      confirm-label="Restart"
      variant="danger"
      @confirm="onRestartConfirmed"
      @cancel="onRestartCancelled"
    />
  </Card>
</template>

<style scoped>
.wp-db__section { margin-bottom: var(--wp-space-6); }
.wp-db__section:last-child { margin-bottom: 0; }
.wp-db__section-title {
  font-size: var(--wp-text-sm);
  color: var(--wp-text-muted);
  margin: 0 0 var(--wp-space-4);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.wp-db__rows {
  display: flex; flex-direction: column;
  gap: var(--wp-space-3);
  margin: 0;
}
.wp-db__rows .wp-db__row {
  display: flex; align-items: baseline;
  gap: var(--wp-space-5);
}
.wp-db__rows--grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--wp-space-3);
}
.wp-db__rows--grid .wp-db__row {
  display: flex; align-items: baseline; justify-content: space-between;
  padding: var(--wp-space-3) var(--wp-space-4);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  background: var(--wp-bg-2);
}
.wp-db__row dt {
  color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
  flex: 0 0 160px;
  white-space: nowrap;
}
.wp-db__row dd {
  margin: 0;
  font-size: var(--wp-text-sm);
  color: var(--wp-text);
  flex: 1; min-width: 0;
  word-break: break-all;
}
.wp-db__rows--grid .wp-db__row dt { flex: 0 1 auto; }
.wp-db__rows--grid .wp-db__row dd { flex: 0 1 auto; word-break: normal; }
.wp-db__chip {
  display: inline-block; padding: 2px 8px;
  background: color-mix(in oklab, var(--wp-accent-500) 18%, transparent);
  color: var(--wp-accent-text);
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 30%, transparent);
  border-radius: 999px;
  font-size: var(--wp-text-xs);
  font-family: var(--wp-font-mono);
}
.wp-db__ops { display: flex; flex-direction: column; gap: 0; }
.wp-db__op-row {
  display: flex; align-items: center; gap: var(--wp-space-5);
  padding: var(--wp-space-4) 0;
  border-bottom: 1px dashed var(--wp-border);
}
.wp-db__op-row:last-child { border-bottom: none; }
.wp-db__op-info { flex: 1; }
.wp-db__op-name {
  font-size: var(--wp-text-md); font-weight: 500; margin: 0 0 var(--wp-space-1);
  display: inline-flex; align-items: center; gap: var(--wp-space-3);
}
.wp-db__op-desc { color: var(--wp-text-dim); font-size: var(--wp-text-xs); margin: 0; }
.wp-db__error, .wp-db__loading {
  display: flex; align-items: center; gap: var(--wp-space-4);
  padding: var(--wp-space-4); color: var(--wp-text-muted);
  font-size: var(--wp-text-sm);
}
.wp-db__error { color: var(--wp-danger-text); }
</style>
