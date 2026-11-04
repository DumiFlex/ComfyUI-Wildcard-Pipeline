<script setup lang="ts">
/**
 * NodeGroupWidget — DOM panel of WP Node Group (`widgets/node-group.ts`).
 *
 * One row per gathered node with its mode chip (click to cycle on → muted
 * → bypassed), and a bar that sets them all. Stateless: the glue reads the
 * members off the graph and applies every change this emits.
 */
import WpSegmented from "@/kit/WpSegmented.vue";
import Chip from "@/kit/Chip.vue";
import { vTooltip } from "@/kit/tooltip";
import type { MemberMode } from "../../extension/node-group";
import type { GroupCovers } from "../../extension/toggle-control";

export interface MemberView {
  id: number | string;
  title: string;
  mode: MemberMode;
}

const props = defineProps<{
  members: MemberView[];
  /** The group node's own mode, repeated to its members. */
  groupMode: MemberMode;
  /** Title of the canvas group it stands for (nothing wired in), or null. */
  wholeGroup?: string | null | undefined;
  /** Which canvas groups it covers when nothing is wired in. */
  covers?: GroupCovers | undefined;
}>();
const emit = defineEmits<{
  "set-member": [id: number | string, mode: MemberMode];
  "set-all": [mode: MemberMode];
  "set-covers": [covers: GroupCovers];
}>();

const COVERS = [
  { value: "smallest", label: "Its group", hint: "The smallest group it sits in, inner groups included" },
  { value: "own", label: "Not inner", hint: "The smallest group it sits in, leaving out groups inside it" },
  { value: "all", label: "Every group", hint: "Every group it sits in, outer ones too" },
];

const ALL = [
  { value: "on", label: "Run", hint: "Let every node run" },
  { value: "muted", label: "Mute", hint: "Mute every node" },
  { value: "bypassed", label: "Bypass", hint: "Bypass every node" },
];
const NEXT: Record<MemberMode, MemberMode> = { on: "muted", muted: "bypassed", bypassed: "on" };
const LABEL: Record<MemberMode, string> = { on: "Runs", muted: "Muted", bypassed: "Bypassed" };

function allMode(): string {
  const modes = new Set(props.members.map((m) => m.mode));
  return modes.size === 1 ? ([...modes][0] ?? "") : "";
}
</script>

<template>
  <div class="wp-ng">
    <div class="wp-ng__bar">
      <span class="wp-ng__count">
        <template v-if="wholeGroup">Whole group: <b class="wp-ng__group" data-test="ng-whole-group">{{ wholeGroup }}</b> · </template>
        {{ members.length }} node{{ members.length === 1 ? "" : "s" }}
      </span>
      <WpSegmented
        v-if="members.length"
        :model-value="allMode()"
        :options="ALL"
        size="sm"
        aria-label="Set every node"
        test-prefix="ng-all"
        @update:model-value="(v: string) => emit('set-all', v as MemberMode)"
      />
    </div>
    <div v-if="wholeGroup" class="wp-ng__covers">
      <span class="wp-ng__covers-label">Covers</span>
      <WpSegmented
        :model-value="covers ?? 'smallest'"
        :options="COVERS"
        size="sm"
        aria-label="Which canvas groups it covers"
        test-prefix="ng-covers"
        @update:model-value="(v: string) => emit('set-covers', v as GroupCovers)"
      />
    </div>
    <div
      v-for="m in members"
      :key="m.id"
      class="wp-ng__row"
      :class="`is-${m.mode}`"
      :data-test="`ng-row-${m.id}`"
    >
      <span class="wp-ng__title">{{ m.title }}</span>
      <span class="wp-ng__id">#{{ m.id }}</span>
      <Chip
        v-tooltip="`Click: ${LABEL[NEXT[m.mode]].toLowerCase()}`"
        as="button"
        class="wp-ng__chip"
        :class="`is-${m.mode}`"
        :data-test="`ng-mode-${m.id}`"
        @click="emit('set-member', m.id, NEXT[m.mode])"
      >
        {{ LABEL[m.mode] }}
      </Chip>
    </div>
    <div v-if="!members.length" class="wp-ng__ghost">
      Wire nodes into the dots on the left, or put this node inside a canvas group to gather the whole
      group. Then wire its output into a WP Toggles control dot, or mute or bypass this node.
    </div>
    <div v-else-if="groupMode !== 'on'" class="wp-ng__note">
      This node is {{ groupMode }}, so its nodes are too.
    </div>
  </div>
</template>

<style scoped>
.wp-ng {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
  color: var(--wp-text);
  font: 12px var(--wp-font-sans, sans-serif);
  min-width: 0;
}
.wp-ng__bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; }
.wp-ng__count { font-size: 10.5px; color: var(--wp-text-dim, var(--wp-text3)); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-ng__group { font-weight: 600; color: var(--wp-text); }
.wp-ng__covers { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; }
.wp-ng__covers-label { font-size: 10.5px; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-ng__row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 2px 4px 2px 8px;
  background: var(--wp-bg2, var(--wp-bg-1));
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  min-width: 0;
}
/* Off rows wear the Context node's disabled-module stripes. */
.wp-ng__row.is-muted,
.wp-ng__row.is-bypassed {
  background: repeating-linear-gradient(45deg, var(--wp-bg3), var(--wp-bg3) 6px, var(--wp-bg2) 6px, var(--wp-bg2) 8px);
}
.wp-ng__row.is-muted .wp-ng__title,
.wp-ng__row.is-bypassed .wp-ng__title { opacity: 0.55; }
.wp-ng__title { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wp-ng__id { font: 10.5px var(--wp-font-mono, monospace); color: var(--wp-text-dim, var(--wp-text3)); }
/* A kit Chip (as a button) in the mode's colour. */
.wp-chip.wp-ng__chip {
  flex: none;
  height: 20px;
  padding: 0 8px;
  border: 1px solid var(--wp-border);
  /* A finite radius, not 999px: Firefox draws a bordered full pill in pieces
     that seam at canvas zooms like 0.64 / 0.8 (docs/component-standard.md). */
  border-radius: min(9px, var(--wp-radius-cap, 999px)); /* 20px tall */
  background: transparent;
  color: var(--wp-text-muted, var(--wp-text2));
  font: 600 10.5px var(--wp-font-sans, sans-serif);
  cursor: pointer;
}
.wp-chip.wp-ng__chip.is-on { border-color: var(--wp-accent); color: var(--wp-accent); }
.wp-chip.wp-ng__chip.is-bypassed { border-color: var(--wp-violet); color: var(--wp-violet); }
.wp-chip.wp-ng__chip:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus, var(--wp-accent)); }
.wp-ng__ghost,
.wp-ng__note { padding: 2px 4px; font-size: 10.5px; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-ng__ghost { font-style: italic; }
</style>
