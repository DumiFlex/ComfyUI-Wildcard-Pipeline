<script setup lang="ts">
/**
 * ModeRelayWidget — DOM panel of WP Mode Relay (`widgets/mode-relay.ts`).
 *
 * Three rows map what the watched nodes do to what the relay sends; a line
 * under them says what it watches, what they are and what it drives.
 * Stateless: the glue owns the map (on `node.properties`) and the graph.
 */
import WpSegmented from "../../kit/WpSegmented.vue";
import type { MemberMode } from "../../extension/node-group";
import type { RelayAction, RelayMap } from "../../extension/mode-relay";

const props = defineProps<{
  map: RelayMap;
  watching: number;
  driving: number;
  state: MemberMode | null;
}>();
const emit = defineEmits<{ "update:map": [map: RelayMap] }>();

const ACTIONS = [
  { value: "run", label: "Run" },
  { value: "mute", label: "Mute" },
  { value: "bypass", label: "Bypass" },
  { value: "nothing", label: "—", hint: "Send nothing" },
];
const ROWS: { key: keyof RelayMap; label: string }[] = [
  { key: "muted", label: "All muted" },
  { key: "bypassed", label: "All bypassed" },
  { key: "on", label: "Any runs" },
];
const STATE: Record<MemberMode, string> = { on: "running", muted: "muted", bypassed: "bypassed" };

function set(key: keyof RelayMap, v: string): void {
  emit("update:map", { ...props.map, [key]: v as RelayAction });
}
</script>

<template>
  <div class="wp-mr">
    <div v-for="r in ROWS" :key="r.key" class="wp-mr__row" :class="{ 'is-now': state === r.key }">
      <span class="wp-mr__when">{{ r.label }}</span>
      <WpSegmented
        :model-value="map[r.key]"
        :options="ACTIONS"
        size="sm"
        :aria-label="`${r.label}: send`"
        :test-prefix="`mr-${r.key}`"
        @update:model-value="(v: string) => set(r.key, v)"
      />
    </div>
    <div class="wp-mr__status" data-test="mr-status">
      <template v-if="!watching">Wire the nodes to watch into the dots on the left.</template>
      <template v-else>
        Watching {{ watching }} node{{ watching === 1 ? "" : "s" }}<template v-if="state">: {{ STATE[state] }}</template><template v-else>: mixed</template>
        · drives {{ driving }} node{{ driving === 1 ? "" : "s" }}
      </template>
    </div>
  </div>
</template>

<style scoped>
.wp-mr {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
  color: var(--wp-text);
  font: 12px var(--wp-font-sans, sans-serif);
  min-width: 0;
}
.wp-mr__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 28px;
  padding: 2px 4px 2px 8px;
  background: var(--wp-bg2, var(--wp-bg-1));
  border-radius: min(4px, var(--wp-radius-cap, 999px));
}
.wp-mr__row.is-now { box-shadow: inset 2px 0 0 var(--wp-accent); }
.wp-mr__when { font-weight: 600; white-space: nowrap; }
.wp-mr__status { padding: 2px 4px; font-size: 10.5px; color: var(--wp-text-dim, var(--wp-text3)); }
</style>
