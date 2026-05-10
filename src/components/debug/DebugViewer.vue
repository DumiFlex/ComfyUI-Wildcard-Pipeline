<script setup lang="ts">
import { computed, ref } from "vue";

const props = withDefaults(
  defineProps<{
    snapshot: string;
    /** Litegraph mode — 0=ALWAYS, 2=NEVER (mute), 4=BYPASS. Drives
     *  the dim overlay so muted/bypassed state matches litegraph's
     *  native title/border dim. */
    nodeMode?: number;
  }>(),
  { nodeMode: 0 },
);

const isSkipped = computed(() => props.nodeMode === 2 || props.nodeMode === 4);

type TabId = "snapshot" | "trace" | "picks" | "warnings";

const activeTab = ref<TabId>("snapshot");

/** Parsed snapshot — null when the snapshot string is empty or malformed. */
const parsed = computed<Record<string, unknown> | null>(() => {
  if (!props.snapshot) return null;
  try {
    const v = JSON.parse(props.snapshot);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
});

/** Snapshot view — strips internal `__wp_*` keys for the user-facing view. */
const snapshotView = computed(() => {
  if (!parsed.value) return "";
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.value)) {
    if (!k.startsWith("__")) out[k] = v;
  }
  return JSON.stringify(out, null, 2);
});

const traceView = computed(() => {
  const trace = parsed.value?.__wp_trace__;
  return Array.isArray(trace) ? JSON.stringify(trace, null, 2) : "(no trace)";
});

const picks = computed<Record<string, unknown>>(() => {
  const p = parsed.value?.__wp_picks__;
  return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
});

const warnings = computed<unknown[]>(() => {
  const w = parsed.value?.__wp_warnings__;
  return Array.isArray(w) ? w : [];
});

const picksCount = computed(() => Object.keys(picks.value).length);
const warningsCount = computed(() => warnings.value.length);

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "snapshot", label: "Snapshot" },
  { id: "trace", label: "Trace" },
  { id: "picks", label: "Picks" },
  { id: "warnings", label: "Warnings" },
];

const bodyText = computed(() => {
  switch (activeTab.value) {
    case "snapshot": return snapshotView.value;
    case "trace":    return traceView.value;
    case "picks":    return JSON.stringify(picks.value, null, 2);
    case "warnings": return JSON.stringify(warnings.value, null, 2);
  }
});

async function copyToClipboard(): Promise<void> {
  try { await navigator.clipboard.writeText(bodyText.value); } catch { /* permission denied */ }
}

function downloadJson(): void {
  if (!parsed.value) return;
  const blob = new Blob([props.snapshot], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "wp-debug-snapshot.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>

<template>
  <div class="wp-debug" :class="{ 'wp-debug--skipped': isSkipped }">
    <div v-if="parsed" class="wp-dbg-tabs" role="tablist">
      <button
        v-for="t in TABS"
        :key="t.id"
        type="button"
        role="tab"
        :class="['wp-dbg-tab', { 'is-active': activeTab === t.id }]"
        :aria-selected="activeTab === t.id"
        @click="activeTab = t.id"
      >
        {{ t.label }}
        <span
          v-if="t.id === 'picks' && picksCount"
          class="wp-dbg-tab-badge"
        >{{ picksCount }}</span>
        <span
          v-else-if="t.id === 'warnings' && warningsCount"
          class="wp-dbg-tab-badge wp-dbg-tab-badge--warn"
        >{{ warningsCount }}</span>
      </button>

      <div class="wp-dbg-toolbar">
        <button
          type="button"
          class="wp-btn wp-btn--icon"
          data-test="dbg-copy"
          title="Copy JSON"
          aria-label="Copy JSON"
          @click="copyToClipboard"
        ><i class="pi pi-copy" /></button>
        <button
          type="button"
          class="wp-btn wp-btn--icon"
          data-test="dbg-download"
          title="Download JSON"
          aria-label="Download JSON"
          @click="downloadJson"
        ><i class="pi pi-download" /></button>
      </div>
    </div>

    <pre v-if="parsed" class="wp-dbg-pre">{{ bodyText }}</pre>
    <p v-else class="wp-debug__empty">Run the graph to capture a snapshot.</p>
  </div>
</template>

<style>
@import "../shared/theme.css";
</style>

<style scoped>
.wp-debug {
  font-family: var(--wp-font-sans, sans-serif);
  font-size: 12px;
  padding: 6px;
  color: var(--wp-text);
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  transition: opacity 120ms ease;
}
/* Mute (mode 2) / bypass (mode 4) — dim widget body so the muted
 * state matches litegraph's native node-frame dim. */
.wp-debug--skipped { opacity: 0.45; }
.wp-dbg-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 6px;
  border-bottom: 1px solid var(--wp-border);
  align-items: center;
}
.wp-dbg-tab {
  background: transparent;
  border: 1px solid transparent;
  border-bottom: 0;
  border-top-left-radius: var(--wp-radius);
  border-top-right-radius: var(--wp-radius);
  margin-bottom: -1px;
  font: 500 11px/1 var(--wp-font-sans);
  color: var(--wp-text-muted);
  padding: 6px 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.wp-dbg-tab:hover { color: var(--wp-text); }
.wp-dbg-tab.is-active {
  color: var(--wp-text);
  background: var(--wp-bg-deep, var(--wp-bg));
  border-color: var(--wp-border);
  border-bottom-color: var(--wp-bg-deep, var(--wp-bg));
}
.wp-dbg-tab-badge {
  font: 600 9px/1 var(--wp-font-mono);
  padding: 2px 4px;
  border-radius: 6px;
  background: var(--wp-bg-deep, var(--wp-bg));
  color: var(--wp-text-dim);
}
.wp-dbg-tab-badge--warn {
  background: color-mix(in srgb, var(--wp-warn) 22%, transparent);
  color: var(--wp-warn);
}
.wp-dbg-toolbar {
  margin-left: auto;
  display: flex;
  gap: 4px;
  padding-bottom: 4px;
}
.wp-btn--icon {
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border-soft);
  color: var(--wp-text);
  font: 500 11px/1 var(--wp-font-sans);
  padding: 4px 5px;
  border-radius: var(--wp-radius);
  cursor: pointer;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.wp-btn--icon:hover { background: var(--wp-bg-2); }
.wp-dbg-pre {
  background: var(--wp-bg-deep, var(--wp-bg));
  color: var(--wp-text);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  padding: 8px 10px;
  margin: 0;
  flex: 1;
  min-height: 0;
  overflow: auto;
  font: 11px/1.5 var(--wp-font-mono, monospace);
  white-space: pre;
  tab-size: 2;
  word-break: normal;
}
.wp-debug__empty {
  color: var(--wp-text3);
  font-style: italic;
  font-family: var(--wp-font-sans, sans-serif);
  text-align: center;
  margin: auto 0;
}
</style>
