<script setup lang="ts">
/**
 * Three-phase modal for a single maintenance operation:
 *   confirm     — title + description + Cancel/Run buttons
 *   loading     — spinner + "Running…"
 *   result-ok   — duration + op-specific extra (bytes_reclaimed, etc.)
 *   result-error— error string in danger-tinted block + Close
 *
 * State is driven by the `phase` prop so the parent (DatabaseCard) owns
 * the transitions and the API call. This component is presentation-only.
 */
import { computed } from "vue";
import Button from "../ui/Button.vue";
import Icon from "../ui/Icon.vue";
import Modal from "../ui/Modal.vue";
import type { MaintenanceOp, MaintenanceResult } from "../../api/types";

type Phase = "confirm" | "loading" | "result-ok" | "result-error";

interface Props {
  open: boolean;
  op: MaintenanceOp;
  title: string;
  description: string;
  confirmLabel: string;
  phase?: Phase;
  result?: MaintenanceResult;
}

const props = withDefaults(defineProps<Props>(), { phase: "confirm" });

const emit = defineEmits<{
  confirm: [];
  close: [];
  "update:open": [v: boolean];
}>();

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const successSummary = computed(() => {
  const r = props.result;
  if (!r || !r.ok) return "";
  if (r.op === "vacuum") return `Reclaimed ${formatBytes(r.bytes_reclaimed)} in ${formatDuration(r.duration_ms)}`;
  if (r.op === "integrity") return `Integrity check passed in ${formatDuration(r.duration_ms)}`;
  if (r.op === "analyze") return `Statistics refreshed in ${formatDuration(r.duration_ms)}`;
  // r.op === "migrate"
  return r.applied.length === 0
    ? `Already at latest version (${formatDuration(r.duration_ms)})`
    : `Applied versions ${r.applied.join(", ")} in ${formatDuration(r.duration_ms)}`;
});

const integrityOutput = computed(() => {
  const r = props.result;
  if (r && r.ok && r.op === "integrity") return r.output.join("\n");
  return "";
});

const errorMessage = computed(() => {
  const r = props.result;
  if (!r || r.ok) return "";
  if (r.error) return r.error;
  if (r.output && r.output.length) return r.output.join("\n");
  return "Operation failed";
});

function onCancel(): void { emit("close"); }
function onConfirm(): void { emit("confirm"); }
function onClose(): void { emit("close"); }
</script>

<template>
  <Modal :open="open" :title="title" size="sm" @update:open="emit('update:open', $event)">
    <div v-if="phase === 'confirm'" class="wp-maintop">
      <p class="wp-maintop__desc">{{ description }}</p>
    </div>

    <div v-else-if="phase === 'loading'" class="wp-maintop wp-maintop--loading" data-test="maintop-spinner">
      <Icon name="spin pi-spinner" :size="18" />
      <span>Running {{ op }}…</span>
    </div>

    <div v-else-if="phase === 'result-ok'" class="wp-maintop">
      <p class="wp-maintop__success">{{ successSummary }}</p>
      <pre
        v-if="integrityOutput"
        class="wp-maintop__output"
      >{{ integrityOutput }}</pre>
    </div>

    <div v-else-if="phase === 'result-error'" class="wp-maintop wp-maintop--error">
      <p class="wp-maintop__error-label">Operation failed</p>
      <pre class="wp-maintop__output wp-maintop__output--error">{{ errorMessage }}</pre>
    </div>

    <template #footer>
      <template v-if="phase === 'confirm'">
        <Button variant="ghost" @click="onCancel">Cancel</Button>
        <Button
          variant="primary"
          icon="pi-check"
          data-test="maintop-confirm"
          @click="onConfirm"
        >{{ confirmLabel }}</Button>
      </template>
      <template v-else-if="phase === 'loading'">
        <Button variant="ghost" disabled>Running…</Button>
      </template>
      <template v-else>
        <Button variant="primary" data-test="maintop-close" @click="onClose">Close</Button>
      </template>
    </template>
  </Modal>
</template>

<style scoped>
.wp-maintop { font-size: var(--wp-text-sm); color: var(--wp-text-muted); line-height: 1.6; }
.wp-maintop__desc { margin: 0; }
.wp-maintop--loading {
  display: flex; align-items: center; gap: var(--wp-space-4);
  color: var(--wp-text);
  padding: var(--wp-space-4) 0;
}
.wp-maintop__success { margin: 0; color: var(--wp-text); }
.wp-maintop__output {
  margin: var(--wp-space-4) 0 0; padding: var(--wp-space-4);
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  font-family: var(--wp-font-mono);
  font-size: var(--wp-text-xs);
  white-space: pre-wrap;
  max-height: 200px;
  overflow: auto;
}
.wp-maintop--error .wp-maintop__error-label {
  margin: 0;
  color: var(--wp-danger-text);
  font-weight: 500;
}
.wp-maintop__output--error {
  border-color: color-mix(in oklab, var(--wp-danger) 40%, transparent);
  color: var(--wp-danger-text);
}
</style>
