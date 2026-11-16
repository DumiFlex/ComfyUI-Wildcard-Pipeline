<script setup lang="ts">
/**
 * One WP Seeds row as the node draws it, in WP Toggles' row look: the name
 * over a mono line with the seed for the frame shown (in the row's name
 * colour) and its mode. Both views: the mode button (Follow → Random →
 * Fixed), "Use last run's seed" and a lock for that frame. Edit view
 * (`editable`) adds the pencil (the row's window) and the bin. A pinned row
 * carries `data-wp-out` so its INT dot sits level with it.
 */
import { computed } from "vue";
import WpIconButton from "@/kit/WpIconButton.vue";
import { vTooltip } from "@/kit/tooltip";
import { varColorClass } from "../shared/var-color";
import { formatSeed, nextMode, type SeedRow } from "../../extension/seeds";

const props = withDefaults(defineProps<{
  r: SeedRow;
  /** The seed the row gives the frame shown. */
  seed: number;
  /** 1-based frame shown, for the lock's label. */
  frame: number;
  locked: boolean;
  /** Tooltip on the seed line (frame, last run, readers). */
  hint?: string | undefined;
  problem?: string | undefined;
  editable?: boolean | undefined;
  editing?: boolean | undefined;
  /** No output dot (the window's preview). */
  noDot?: boolean | undefined;
  /** The seed the row started from last run (none before a run). */
  lastSeed?: number | undefined;
}>(), { hint: undefined, problem: undefined, editable: false, editing: false, noDot: false, lastSeed: undefined });
const emit = defineEmits<{ lock: []; edit: []; remove: []; cycle: []; last: [] }>();

const MODE_TEXT: Record<SeedRow["mode"], string> = { follow: "follows base seed", random: "random", fixed: "fixed" };
const MODE_NAME: Record<SeedRow["mode"], string> = { follow: "Follow base seed", random: "Random", fixed: "Fixed" };
const MODE_ICON: Record<SeedRow["mode"], string> = { follow: "pi-link", random: "pi-sync", fixed: "pi-equals" };

const modeHint = computed(() => `${MODE_NAME[props.r.mode]}. Click for ${MODE_NAME[nextMode(props.r.mode)]}`);
/** Already on last run's seed: nothing to restore. */
const onLast = computed(() => props.lastSeed !== undefined && props.r.mode === "fixed" && props.r.value === props.lastSeed);
const lastHint = computed(() => {
  if (props.lastSeed === undefined) return "Use last run's seed: queue once first";
  if (onLast.value) return `On last run's seed (${formatSeed(props.lastSeed)})`;
  return `Use last run's seed: ${formatSeed(props.lastSeed)} (sets the row to Fixed)`;
});
</script>

<template>
  <div
    class="wp-sdr"
    :class="{ 'is-editing': editing }"
    :data-wp-out="!noDot && r.pin && r.out ? `seed_${r.out}` : undefined"
    :data-test="`seeds-row-${r.id}`"
  >
    <span class="wp-sdr__name">
      <b>{{ r.name || "Unnamed" }}</b>
      <span v-tooltip="hint" class="wp-sdr__sub">
        <i v-if="locked" class="pi pi-lock wp-sdr__lockmark" aria-label="Locked" />
        <span class="wp-sdr__seed" :class="locked ? 'is-locked' : varColorClass(r.name)" data-test="seeds-seed">{{ formatSeed(seed) }}</span>
        <span class="wp-sdr__mode">· {{ MODE_TEXT[r.mode] }}<template v-if="r.per_frame === 'same'">, same every frame</template></span>
      </span>
    </span>
    <i v-if="problem" v-tooltip="problem" class="pi pi-exclamation-triangle wp-sdr__warn" role="img" :aria-label="problem" />
    <span class="wp-sdr__btns">
      <WpIconButton
        :icon="MODE_ICON[r.mode]"
        :label="`Mode: ${MODE_NAME[r.mode]}`"
        :hint="modeHint"
        :data-test="`seeds-mode-${r.id}`"
        @click="emit('cycle')"
      />
      <WpIconButton
        icon="pi-history"
        label="Use last run's seed"
        :hint="lastHint"
        :disabled="lastSeed === undefined || onLast"
        :data-test="`seeds-last-${r.id}`"
        @click="emit('last')"
      />
      <WpIconButton
        :icon="locked ? 'pi-lock' : 'pi-lock-open'"
        :label="locked ? `Unlock frame ${frame}` : `Lock frame ${frame}`"
        :pressed="locked"
        :tone="locked ? 'accent' : 'neutral'"
        :data-test="`seeds-lock-${r.id}`"
        @click="emit('lock')"
      />
      <template v-if="editable">
        <WpIconButton icon="pi-pencil" :pressed="editing" :label="`Edit ${r.name || 'seed'}`" :data-test="`seeds-edit-${r.id}`" @click="emit('edit')" />
        <WpIconButton icon="pi-trash" tone="danger" :label="`Remove ${r.name || 'seed'}`" :data-test="`seeds-remove-${r.id}`" @click="emit('remove')" />
      </template>
    </span>
  </div>
</template>

<style scoped>
.wp-sdr {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-height: 38px;
  padding: 3px 6px 3px 8px;
  background: var(--wp-bg2, var(--wp-bg-1));
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  box-sizing: border-box;
  min-width: 0;
}
.wp-sdr.is-editing { box-shadow: inset 0 0 0 1px var(--wp-accent); }
.wp-sdr__name { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.wp-sdr__name b {
  font-weight: 600;
  font-size: 12px;
  line-height: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-sdr__sub {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font: 10.5px/14px var(--wp-font-mono, monospace);
  white-space: nowrap;
  overflow: hidden;
}
.wp-sdr__seed { flex: none; }
.wp-sdr__seed.is-locked { color: var(--wp-accent-text, var(--wp-accent)); }
.wp-sdr__lockmark { flex: none; font-size: 9px; color: var(--wp-accent-text, var(--wp-accent)); }
.wp-sdr__mode {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--wp-font-sans, sans-serif);
  color: var(--wp-text-dim, var(--wp-text3));
}
.wp-sdr__warn { flex: none; font-size: 11px; color: var(--wp-amber, var(--wp-warn)); }
.wp-sdr__btns { display: inline-flex; align-items: center; gap: 2px; flex: none; }
</style>
