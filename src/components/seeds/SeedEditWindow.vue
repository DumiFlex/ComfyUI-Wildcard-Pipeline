<script setup lang="ts">
/**
 * One WP Seeds row's settings, in a kit `Modal`, like WP Toggles' toggle
 * window: the node keeps its edit view (order, labels, bin) and the row's
 * pencil opens this. It edits a draft of the row; Done hands it back to
 * `SeedsWidget.vue`. The strip on top is the row as the node will draw it;
 * Frames shows the row's seed on every frame of the Context Loop, each one a
 * lock.
 */
import { computed, ref } from "vue";
import Input from "@/kit/Input.vue";
import WpNumber from "@/kit/WpNumber.vue";
import WpSegmented from "@/kit/WpSegmented.vue";
import Checkbox from "@/kit/Checkbox.vue";
import Modal from "@/kit/Modal.vue";
import ConfirmModal from "@/kit/ConfirmModal.vue";
import Button from "@/kit/Button.vue";
import Kbd from "@/kit/Kbd.vue";
import Banner from "@/kit/Banner.vue";
import ColorField from "@/kit/ColorField.vue";
import IconPicker from "@/kit/IconPicker.vue";
import { vTooltip } from "@/kit/tooltip";
import { vToggleRow } from "@/kit/toggle-row";
import SeedRowView from "./SeedRow.vue";
import { varColorClass } from "../shared/var-color";
import {
  MAX_OUTPUTS,
  formatSeed,
  lockOf,
  maskSeedValue,
  nameKey,
  randomSeed,
  nextMode,
  rowSeed,
  seedRows,
  withLock,
  type PerFrame,
  type SeedMode,
  type SeedRow,
  type SeedsConfig,
} from "../../extension/seeds";
import type { LastRun } from "./types";
import { colorFieldValue, pickedColor } from "../../extension/looks";

/** Frames listed in the window (a longer loop keeps its locks all the same). */
const MAX_FRAMES = 48;

const props = withDefaults(defineProps<{
  row: SeedRow;
  config: SeedsConfig;
  baseSeed: number;
  /** The seed the row started from last run (none before a run). */
  lastSeed?: number | undefined;
  frames?: number | undefined;
  lastRun?: LastRun | undefined;
  /** Titles of the Contexts set to read this row. */
  usedBy?: string[] | undefined;
  nodeTitle?: string | undefined;
}>(), { lastSeed: undefined, frames: 1, lastRun: () => ({}), usedBy: () => [], nodeTitle: "" });
const emit = defineEmits<{ done: [next: SeedRow]; cancel: [] }>();

const d = ref<SeedRow>(JSON.parse(JSON.stringify(props.row)) as SeedRow);
const dirty = computed(() => JSON.stringify(d.value) !== JSON.stringify(props.row));
const asking = ref(false);

function patch(p: Partial<SeedRow>): void {
  const next: SeedRow = { ...d.value, ...p };
  // Looks cleared to None leave no key behind.
  for (const k of ["icon", "icon_color", "text_color", "tint"] as const) if (!next[k]) delete next[k];
  d.value = next;
}
/** The header wears the row's looks: icon colour, name colour, seed tint. */
const headStyle = computed(() => {
  const s: Record<string, string> = {};
  if (d.value.icon_color) s["--wp-sdw-icon"] = d.value.icon_color;
  if (d.value.text_color) s["--wp-sdw-text"] = d.value.text_color;
  if (d.value.tint) s["--wp-sdw-tint"] = d.value.tint;
  return s;
});

const MODES: { value: SeedMode; label: string; hint: string }[] = [
  { value: "follow", label: "Follow base seed", hint: "Made from the node's base seed and this row's name" },
  { value: "random", label: "Random", hint: "Its own seed, rolled again after every queue" },
  { value: "fixed", label: "Fixed", hint: "Its own seed, never changes" },
];
const MODE_NOTE: Record<SeedMode, string> = {
  follow: "the node's base seed and this name make it; Reroll on the node (or the Loop's seed, with From Loop on) moves it",
  random: "rolled again each time you queue; the run keeps the one it was queued with",
  fixed: "stays as it is until you change it",
};
const PER_FRAME: { value: PerFrame; label: string; hint: string }[] = [
  { value: "new", label: "New each frame", hint: "Frame 1 gets the seed, later frames are made from it" },
  { value: "same", label: "Same every frame", hint: "Every frame uses the seed" },
];

function setMode(mode: SeedMode): void {
  // Leaving Follow keeps the seed the row has now, so nothing jumps.
  if (d.value.mode === "follow" && mode !== "follow") {
    patch({ mode, value: rowSeed({ ...d.value, locks: undefined, per_frame: "same" }, props.baseSeed, 0) });
  } else patch({ mode });
}

const base = computed(() => rowSeed({ ...d.value, locks: undefined, per_frame: "same" }, props.baseSeed, 0));
const nameTaken = computed(() => {
  const key = nameKey(d.value.name);
  return !!key && seedRows(props.config).some((r) => r.id !== d.value.id && nameKey(r.name) === key);
});
const outputsFull = computed(() => seedRows(props.config).filter((r) => r.pin && r.id !== d.value.id).length >= MAX_OUTPUTS);

interface FrameCell { index: number; seed: number; locked: boolean; last: number | undefined }
const frameCells = computed<FrameCell[]>(() => {
  const n = Math.min(Math.max(1, props.frames), MAX_FRAMES);
  return Array.from({ length: n }, (_, index) => ({
    index,
    seed: rowSeed(d.value, props.baseSeed, index),
    locked: lockOf(d.value, index) !== undefined,
    last: props.lastRun[String(index)]?.[d.value.id],
  }));
});
const hasLastRun = computed(() => frameCells.value.some((c) => c.last !== undefined));
const lockedCount = computed(() => Object.keys(d.value.locks ?? {}).length);

function toggleFrame(c: FrameCell): void {
  d.value = withLock(d.value, c.index, c.locked ? null : (c.last ?? c.seed));
}
function lockLastRun(): void {
  let next = d.value;
  for (const c of frameCells.value) if (c.last !== undefined) next = withLock(next, c.index, c.last);
  d.value = next;
}
function unlockAll(): void {
  const next = { ...d.value };
  delete next.locks;
  d.value = next;
}
function cellHint(c: FrameCell): string {
  const lines = [c.locked ? `Frame ${c.index + 1} is locked: click to unlock` : `Click to lock frame ${c.index + 1}`];
  if (c.last !== undefined) lines.push(`Last run: ${formatSeed(c.last)}`);
  return lines.join("\n");
}

function cancel(): void {
  if (dirty.value) asking.value = true;
  else emit("cancel");
}
function onKey(ev: KeyboardEvent): void {
  if (!asking.value && ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
    ev.preventDefault();
    emit("done", d.value);
  }
}
</script>

<template>
  <Modal :open="true" size="md" @update:open="(v: boolean) => { if (!v) cancel(); }" @keydown="onKey">
    <template #header="{ titleId }">
      <i class="pi wp-sdw__icon" :class="d.icon ? `pi-${d.icon}` : 'pi-hashtag'" :style="headStyle" aria-hidden="true" data-test="seeds-window-icon" />
      <div class="wp-sdw__titles" :style="headStyle">
        <div class="wp-sdw__title-row">
          <h3 :id="titleId" class="wp-sdw__title">{{ nodeTitle || "WP Seeds" }}</h3>
          <span class="wp-sdw__chip">Seed</span>
        </div>
        <div class="wp-sdw__sub">
          <span class="wp-sdw__subname">{{ d.name || "Unnamed" }}</span>
          <span aria-hidden="true"> · </span>
          <span class="wp-sdw__subseed" :class="d.tint ? 'has-tint' : varColorClass(d.name)">{{ formatSeed(base) }}</span>
        </div>
      </div>
    </template>
    <div class="wp-sdw__preview" data-test="seeds-window-preview">
      <span class="wp-sdw__cap">ON THE NODE</span>
      <SeedRowView :r="d" :seed="rowSeed(d, baseSeed, 0)" :frame="1" :locked="lockOf(d, 0) !== undefined" no-dot :last-seed="lastSeed" @lock="toggleFrame(frameCells[0] as FrameCell)" @cycle="setMode(nextMode(d.mode))" @last="lastSeed !== undefined && patch({ mode: 'fixed', value: lastSeed })" />
    </div>
    <div class="wp-sdw__body">
      <label class="wp-sdw__field">
        <span>Name <em>WP Context nodes pick the row by it</em></span>
        <Input size="sm" :model-value="d.name" :tone="nameTaken || !d.name.trim() ? 'warn' : undefined" spellcheck="false" data-test="seeds-name" @keydown.stop @change="patch({ name: ($event.target as HTMLInputElement).value.trim() })" />
      </label>
      <Banner v-if="nameTaken" tone="warn" size="sm">Another row has this name; Contexts read the first one.</Banner>
      <div class="wp-sdw__field">
        <span>Looks <em>icon and colours; None keeps the theme's</em></span>
        <span class="wp-sdw__looks">
          <IconPicker
            :model-value="d.icon ?? null"
            all
            size="sm"
            :color="d.icon_color"
            aria-label="Icon"
            data-test="seeds-icon"
            @update:model-value="(v: string | null) => patch({ icon: v || undefined })"
          />
          <span class="wp-sdw__look">
            <ColorField :model-value="colorFieldValue(d.icon_color)" allow-none presets compact aria-label="Icon colour" data-test="seeds-icon-color" @update:model-value="(v: string) => patch({ icon_color: pickedColor(v) })" />
            Icon
          </span>
          <span class="wp-sdw__look">
            <ColorField :model-value="colorFieldValue(d.text_color)" allow-none presets compact aria-label="Name colour" data-test="seeds-text-color" @update:model-value="(v: string) => patch({ text_color: pickedColor(v) })" />
            Name
          </span>
          <span class="wp-sdw__look">
            <ColorField :model-value="colorFieldValue(d.tint)" allow-none presets compact aria-label="Seed colour" data-test="seeds-tint" @update:model-value="(v: string) => patch({ tint: pickedColor(v) })" />
            Seed
          </span>
        </span>
      </div>
      <div class="wp-sdw__field">
        <span>Seed <em>{{ MODE_NOTE[d.mode] }}</em></span>
        <WpSegmented :model-value="d.mode" :options="MODES" size="sm" block aria-label="Mode" test-prefix="seeds-mode" @update:model-value="setMode" />
        <span class="wp-sdw__seedrow">
          <WpNumber
            :model-value="d.mode === 'follow' ? base : d.value"
            :min="0"
            :disabled="d.mode === 'follow'"
            size="sm"
            class="wp-sdw__seed"
            aria-label="Seed"
            data-test="seeds-value"
            @update:model-value="(v: number | null) => patch({ value: maskSeedValue(v ?? 0) })"
          />
          <Button size="sm" variant="ghost" icon="pi-refresh" :disabled="d.mode === 'follow'" hint="A new random seed" data-test="seeds-new" @click="patch({ value: randomSeed() })">New</Button>
          <Button
            size="sm"
            variant="ghost"
            icon="pi-history"
            :disabled="lastSeed === undefined || (d.mode === 'fixed' && d.value === lastSeed)"
            :hint="lastSeed === undefined ? 'Queue once first' : `The seed this row started from last run: ${formatSeed(lastSeed)} (sets Fixed)`"
            data-test="seeds-use-last"
            @click="lastSeed !== undefined && patch({ mode: 'fixed', value: lastSeed })"
          >Last run</Button>
        </span>
      </div>
      <div class="wp-sdw__field">
        <span>In a Context Loop <em>after the Loop, the node runs once per frame</em></span>
        <WpSegmented :model-value="d.per_frame" :options="PER_FRAME" size="sm" block aria-label="In a Context Loop" test-prefix="seeds-per-frame" @update:model-value="(v: PerFrame) => patch({ per_frame: v })" />
      </div>
      <div class="wp-sdw__field">
        <span class="wp-sdw__head">
          Frames
          <em>{{ frames > 1 ? `click a frame to lock its seed${lockedCount ? ` · ${lockedCount} locked` : ""}` : "one frame without a Context Loop upstream" }}</em>
          <span class="wp-sdw__spacer" />
          <Button v-if="hasLastRun" size="sm" variant="ghost" icon="pi-lock" hint="Lock every frame to the seed it used last run" data-test="seeds-lock-last" @click="lockLastRun">Lock last run</Button>
          <Button v-if="lockedCount" size="sm" variant="ghost" icon="pi-lock-open" data-test="seeds-unlock-all" @click="unlockAll">Unlock all</Button>
        </span>
        <div class="wp-sdw__frames">
          <Button
            v-for="c in frameCells"
            :key="c.index"
            v-tooltip="cellHint(c)"
            size="sm"
            :pressed="c.locked"
            :icon="c.locked ? 'pi-lock' : undefined"
            class="wp-sdw__cell"
            :data-test="`seeds-cell-${c.index}`"
            @click="toggleFrame(c)"
          ><span class="wp-sdw__cellno">#{{ c.index + 1 }}</span><span class="wp-sdw__cellseed">{{ formatSeed(c.seed) }}</span></Button>
        </div>
        <span v-if="frames > MAX_FRAMES" class="wp-sdw__more">The first {{ MAX_FRAMES }} of {{ frames }} frames.</span>
      </div>
      <span class="wp-sdw__read">{{ usedBy.length ? `Read by ${usedBy.join(", ")}` : "No WP Context reads it yet: pick it in a Context's Seed from chip, or wire its output." }}</span>
      <span v-tooltip="!d.pin && outputsFull ? `All ${MAX_OUTPUTS} outputs are in use` : 'An INT output for a sampler, detailer or upscaler seed'" v-toggle-row class="wp-sdw__check">
        <Checkbox :model-value="d.pin" size="sm" :disabled="!d.pin && outputsFull" aria-label="INT output" data-test="seeds-pin" @update:model-value="(v: boolean) => patch({ pin: v })" />
        <span aria-hidden="true">INT output</span>
      </span>
    </div>
    <template #footer>
      <span class="wp-sdw__hint"><Kbd keys="Mod+Enter" size="sm" /> Done · Changes save with the node when you press Done.</span>
      <Button size="sm" data-test="seeds-window-cancel" @click="cancel">Cancel</Button>
      <Button size="sm" variant="primary" data-test="seeds-window-done" @click="emit('done', d)">Done</Button>
    </template>
  </Modal>
  <ConfirmModal
    :open="asking"
    title="Discard your changes?"
    body="What you changed in this window isn't on the node yet."
    confirm-label="Discard"
    cancel-label="Keep editing"
    tone="warn"
    @confirm="asking = false; emit('cancel')"
    @cancel="asking = false"
  />
</template>

<style scoped>
.wp-sdw__preview {
  position: sticky;
  top: calc(-1 * var(--wp-space-5));
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: calc(-1 * var(--wp-space-5)) calc(-1 * var(--wp-space-5)) var(--wp-space-5);
  padding: 10px var(--wp-space-5);
  border-bottom: 1px solid var(--wp-border);
  background: var(--wp-bg-deep, var(--wp-bg));
}
.wp-sdw__icon { color: var(--wp-sdw-icon, var(--wp-accent)); font-size: 14px; }
.wp-sdw__titles { flex: 1; min-width: 0; }
.wp-sdw__title-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wp-sdw__title { margin: 0; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wp-sdw__chip {
  flex: none;
  padding: 2px 6px;
  border-radius: min(2px, var(--wp-radius-cap, 999px));
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: color-mix(in srgb, var(--wp-accent) 22%, transparent);
  color: var(--wp-accent);
}
.wp-sdw__sub { margin-top: 3px; font-size: 11px; color: var(--wp-text-dim); }
.wp-sdw__subname { color: var(--wp-sdw-text, var(--wp-text)); font-weight: 600; }
.wp-sdw__subseed { font-family: var(--wp-font-mono, monospace); }
.wp-sdw__subseed.has-tint { color: var(--wp-sdw-tint); }
.wp-sdw__looks { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.wp-sdw__look { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--wp-text-muted, var(--wp-text2)); }
.wp-sdw__cap { font: 600 9px var(--wp-font-sans, sans-serif); letter-spacing: 0.08em; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-sdw__body { display: flex; flex-direction: column; gap: 10px; }
.wp-sdw__field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.wp-sdw__field > span:first-child { font-size: 10.5px; font-weight: 600; color: var(--wp-text-muted, var(--wp-text2)); }
.wp-sdw__field em { font-style: normal; font-weight: 400; color: var(--wp-text-dim, var(--wp-text3)); margin-left: 4px; }
.wp-sdw__head { display: flex; align-items: center; gap: 4px; min-height: 24px; }
.wp-sdw__spacer { flex: 1; }
.wp-sdw__seedrow { display: flex; align-items: center; gap: 6px; }
.wp-sdw__seed { flex: 1; min-width: 0; }
.wp-sdw__frames {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 4px;
}
.wp-sdw__cell { justify-content: flex-start; font-variant-numeric: tabular-nums; }
.wp-sdw__cellno { min-width: 3ch; margin-right: 8px; color: var(--wp-text-dim, var(--wp-text3)); font-size: 10.5px; }
.wp-sdw__cellseed { font: 11px var(--wp-font-mono, monospace); }
.wp-sdw__more, .wp-sdw__read { font-size: 11px; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-sdw__check { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer; align-self: flex-start; }
.wp-sdw__hint { display: inline-flex; align-items: center; gap: 4px; margin-right: auto; font-size: 11px; color: var(--wp-text-dim); }
</style>
