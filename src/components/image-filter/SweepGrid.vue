<script setup lang="ts">
/**
 * SweepGrid — the Image Filter picker's grid for a Context Loop sweep: one
 * swept wildcard down, one across, and one small grid per value of the rest
 * ("Split by"). A bar picks which wildcard goes where; clicking a row,
 * column or group name picks all of it.
 */
import { computed } from "vue";
import PickerTile from "./PickerTile.vue";
import { axisHueAt } from "../shared/axis-color";
import { moveAxis, type GridLayout, type SweepAxisInfo, type SweepGrid } from "./picker-loop";
import { pickKey, viewUrl, type ImageRef, type PickEdits } from "./types";

const props = defineProps<{
  grid: SweepGrid;
  axes: readonly SweepAxisInfo[];
  layout: GridLayout;
  frames: readonly ImageRef[][];
  picked: ReadonlySet<string>;
  edits: PickEdits;
  tooltip: (frame: number) => string;
}>();
const emit = defineEmits<{
  "update:layout": [layout: GridLayout];
  toggle: [key: string];
  toggleFrames: [frames: number[]];
  zoom: [frame: number, image: number];
  hover: [frame: number, image: number, on: boolean];
}>();

const split = computed(() => props.grid.groups.length > 1);
const tileSize = computed(() => (split.value || props.grid.cols.length > 4 ? "108px" : "150px"));

function hue(axis: number): Record<string, string> {
  return { "--wp-ifg-hue": axisHueAt(axis) };
}
function setSlot(slot: "rows" | "cols", ev: Event): void {
  const axis = Number((ev.target as HTMLSelectElement).value);
  emit("update:layout", moveAxis(props.layout, slot, axis));
}
function swap(): void {
  emit("update:layout", { rows: props.layout.cols, cols: props.layout.rows });
}
function rowFrames(cells: number[][], r: number): number[] {
  return (cells[r] ?? []).filter((f) => f >= 0);
}
function colFrames(cells: number[][], c: number): number[] {
  return cells.map((row) => row[c] ?? -1).filter((f) => f >= 0);
}
function pickedIn(frames: number[]): number {
  return frames.filter((f) => (props.frames[f] ?? []).some((_, i) => props.picked.has(pickKey(f, i)))).length;
}
function isEdited(key: string): boolean {
  const e = props.edits[key];
  return !!e && (e.positive !== undefined || e.negative !== undefined);
}
</script>

<template>
  <div class="wp-ifg" :style="{ '--wp-ifp-tile': tileSize }">
    <div class="wp-ifg__bar">
      <label class="wp-ifg__slot">Rows
        <select class="wp-ifg__select" :value="layout.rows" data-test="image-filter-grid-rows" @change="setSlot('rows', $event)">
          <option v-for="(a, i) in axes" :key="a.uid" :value="i">{{ a.name }}</option>
        </select>
      </label>
      <button type="button" class="wp-ifg__swap" title="Swap rows and columns" data-test="image-filter-grid-swap" @click="swap">⇄</button>
      <label class="wp-ifg__slot">Columns
        <select class="wp-ifg__select" :value="layout.cols" data-test="image-filter-grid-cols" @change="setSlot('cols', $event)">
          <option v-for="(a, i) in axes" :key="a.uid" :value="i">{{ a.name }}</option>
        </select>
      </label>
      <span v-if="grid.splitAxes.length" class="wp-ifg__slot">Split by
        <span v-for="a in grid.splitAxes" :key="a.axis" class="wp-ifg__name" :style="hue(a.axis)">{{ a.name }}</span>
      </span>
      <span class="wp-ifg__spacer" />
      <span class="wp-ifg__hint">Click a row, column or group name to pick all of it, a frame&apos;s border to zoom in.</span>
    </div>

    <div class="wp-ifg__groups" :class="{ 'is-split': split }">
      <section
        v-for="(g, gi) in grid.groups"
        :key="gi"
        class="wp-ifg__group"
        :class="{ 'is-card': split }"
        :data-test="`image-filter-grid-group-${gi}`"
      >
        <button
          v-if="g.title.length"
          type="button"
          class="wp-ifg__group-head"
          title="Pick or clear this whole group"
          @click="emit('toggleFrames', g.frames)"
        >
          <template v-for="t in g.title" :key="t.axis">
            <span class="wp-ifg__name">{{ t.name }}</span>
            <span class="wp-ifg__chip" :style="hue(t.axis)">{{ t.value }}</span>
          </template>
          <span class="wp-ifg__count">{{ pickedIn(g.frames) }} of {{ g.frames.length }} picked</span>
        </button>
        <div class="wp-ifg__table" :style="{ gridTemplateColumns: `auto repeat(${grid.cols.length}, auto)` }">
          <span class="wp-ifg__corner">{{ grid.rowAxis.name }} ╲ {{ grid.colAxis.name }}</span>
          <button
            v-for="(c, ci) in grid.cols"
            :key="`c${ci}`"
            type="button"
            class="wp-ifg__chip wp-ifg__col"
            :style="hue(grid.colAxis.axis)"
            :title="`Pick or clear the ${c} column`"
            :data-test="`image-filter-grid-col-${gi}-${ci}`"
            @click="emit('toggleFrames', colFrames(g.cells, ci))"
          >{{ c }}</button>
          <template v-for="(r, ri) in grid.rows" :key="`r${ri}`">
            <button
              type="button"
              class="wp-ifg__chip wp-ifg__row"
              :style="hue(grid.rowAxis.axis)"
              :title="`Pick or clear the ${r} row`"
              :data-test="`image-filter-grid-row-${gi}-${ri}`"
              @click="emit('toggleFrames', rowFrames(g.cells, ri))"
            >{{ r }}</button>
            <div v-for="(f, ci) in g.cells[ri]" :key="`${ri}-${ci}`" class="wp-ifg__cell">
              <div
                v-if="f >= 0"
                class="wp-ifg__tiles"
                :data-test="`image-filter-frame-${f}`"
                :title="`${tooltip(f)}\nClick the image to pick it, the frame around it to zoom in.`"
                @click="emit('zoom', f, 0)"
              >
                <PickerTile
                  v-for="(img, i) in frames[f]"
                  :key="i"
                  :src="viewUrl(img)"
                  :picked="picked.has(pickKey(f, i))"
                  :index="(frames[f]?.length ?? 0) > 1 ? i + 1 : 0"
                  :edited="isEdited(pickKey(f, i))"
                  :masked="!!edits[pickKey(f, i)]?.mask"
                  :test-id="`image-filter-tile-${f}-${i}`"
                  @toggle="emit('toggle', pickKey(f, i))"
                  @zoom="emit('zoom', f, i)"
                  @hover="(on) => emit('hover', f, i, on)"
                />
              </div>
              <span v-else class="wp-ifg__empty" aria-label="Not in this run">—</span>
            </div>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
@import "../shared/theme.css";

.wp-ifg { display: flex; flex-direction: column; min-height: 0; flex: 1; width: 100%; }
.wp-ifg__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 8px 14px; border-bottom: 1px solid var(--wp-border); background: var(--wp-bg-deep, var(--wp-bg)); font: 11px var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text3)); flex-shrink: 0; }
.wp-ifg__slot { display: inline-flex; align-items: center; gap: 6px; }
.wp-ifg__select { padding: 3px 6px; border: 1px solid var(--wp-border); border-radius: 4px; background: var(--wp-bg3); color: var(--wp-text); font: 11px var(--wp-font-mono, monospace); cursor: pointer; }
.wp-ifg__select:focus { outline: none; border-color: var(--wp-accent); }
.wp-ifg__swap { background: transparent; border: 0; padding: 2px 4px; color: var(--wp-accent-text, var(--wp-accent)); font-size: 14px; cursor: pointer; }
.wp-ifg__spacer { flex: 1; }
.wp-ifg__hint { font-size: 10.5px; }
.wp-ifg__name { font: 10.5px var(--wp-font-mono, monospace); color: var(--wp-text-dim, var(--wp-text3)); }
.wp-ifg__bar .wp-ifg__name { color: color-mix(in srgb, var(--wp-ifg-hue) 80%, var(--wp-text)); }

.wp-ifg__groups { overflow: auto; flex: 1; min-height: 0; padding: 14px; display: flex; flex-wrap: wrap; gap: 14px; justify-content: center; align-content: flex-start; }
.wp-ifg__group { display: flex; flex-direction: column; gap: 8px; }
.wp-ifg__group.is-card { padding: 10px 12px; border: 1px solid var(--wp-border); border-radius: 8px; background: var(--wp-bg-deep, var(--wp-bg)); }
.wp-ifg__group-head { display: flex; align-items: center; gap: 6px; padding: 0; border: 0; background: transparent; cursor: pointer; text-align: left; }
.wp-ifg__group-head:hover .wp-ifg__chip { filter: brightness(1.2); }
.wp-ifg__count { margin-left: auto; padding-left: 16px; font: 10.5px var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text3)); }

.wp-ifg__table { display: grid; gap: 8px; align-items: center; justify-items: center; width: max-content; margin: 0 auto; }
.wp-ifg__corner { justify-self: end; font: 10.5px var(--wp-font-mono, monospace); color: var(--wp-text-dim, var(--wp-text3)); white-space: nowrap; }
.wp-ifg__chip { padding: 2px 8px; border: 0; border-radius: 4px; font: 11px var(--wp-font-mono, monospace); white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; color: color-mix(in srgb, var(--wp-ifg-hue) 85%, #fff); background: color-mix(in srgb, var(--wp-ifg-hue) 18%, transparent); }
button.wp-ifg__chip { cursor: pointer; }
button.wp-ifg__chip:hover { background: color-mix(in srgb, var(--wp-ifg-hue) 32%, transparent); }
.wp-ifg__row { justify-self: end; }
.wp-ifg__cell { display: flex; justify-content: center; }
.wp-ifg__tiles { display: flex; gap: 4px; padding: 4px; border: 1px solid var(--wp-border); border-radius: 5px; background: var(--wp-bg-deep, var(--wp-bg)); cursor: zoom-in; }
.wp-ifg__tiles:hover { border-color: var(--wp-accent); }
.wp-ifg__empty { color: var(--wp-text-dim, var(--wp-text3)); }
</style>
