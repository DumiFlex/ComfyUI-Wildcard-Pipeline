<script setup lang="ts">
/**
 * One toggle row of WP Toggles (its settings open in `ToggleEditWindow.vue`). Stateless:
 * the parent (`TogglesWidget.vue`) works out every fact shown here and
 * applies every change this emits.
 *
 * The row carries `data-wp-out="toggle_<out>"` while it has an output, so
 * `extension/row-outputs.ts` puts that BOOLEAN dot at the row's right edge.
 */
import WpIconButton from "@/kit/WpIconButton.vue";
import ToggleCtlButton from "./ToggleCtlButton.vue";
import ToggleLockButton, { type LockSpot } from "./ToggleLockButton.vue";
import WpSegmented from "@/kit/WpSegmented.vue";
import WpSwitch from "@/kit/WpSwitch.vue";
import Checkbox from "@/kit/Checkbox.vue";
import { vTooltip } from "@/kit/tooltip";
import { varColorClass } from "../shared/var-color";
import { computed } from "vue";
import { hasCtlDot, type PickStyle, type ToggleRow, type ToggleStyle } from "../../extension/toggles";
import { ctlInputName, type ControlState, type FocusSpotView } from "../../extension/toggle-control";
import type { VarProducerLike } from "../../manager/components/RefChip.vue";

interface Choice { value: string; label: string }

const props = defineProps<{
  t: ToggleRow;
  /** Pick one mode: every row wears `pickStyle` instead of its own style. */
  pickOne: boolean;
  /** Pick one's look for every row (default radio). */
  pickStyle?: PickStyle | undefined;
  /** What the control shows (Pick one: picked; Any on: own choice). */
  shownOn: boolean;
  /** The output's value after needs / Pick one. */
  effOn: boolean;
  /** Name of the toggle this one needs (Any on), "" for none. */
  parentName: string;
  /** Off because that toggle is off. */
  blocked: boolean;
  problem?: string;
  /** Left indent in px (needs depth). */
  indent: number;
  /** Grid tile: its dots live on the socket line under the grid, so the
   *  tile carries no `data-wp-out` / `data-wp-socket` of its own. */
  tile?: boolean | undefined;
  editing: boolean;
  needsOptions: Choice[];
  /** Label groups to move to; empty hides the field. */
  groupOptions: Choice[];
  groupId: string;
  /** All 16 outputs are taken (an unpinned toggle can't get one). */
  outputsFull: boolean;
  /** Edit view: show the pencil and the edit panel. */
  editable: boolean;
  /** Mute / bypass icon state; null while nothing is wired. */
  controlState?: ControlState | null;
  /** Where its mute / bypass reaches; the icon's click shows them. */
  focusSpots?: FocusSpotView[] | undefined;
  /** Canvas group titles to offer in the edit panel. */
  canvasGroups?: string[];
  /** `$` suggestions for the Pick one Value: upstream + the toggles' own. */
  varSuggestions?: string[];
  /** Who writes each upstream `$var`, for the Value's chip hover card. */
  varProducers?: Map<string, VarProducerLike> | undefined;
  /** Codenames of this toggle's lock targets no longer on the canvas. */
  lockMissing?: string[] | undefined;
  /** The rows it locks; the lock icon's click shows them. */
  lockSpots?: LockSpot[] | undefined;
}>();

const emit = defineEmits<{
  "set-on": [on: boolean];
  patch: [patch: Partial<ToggleRow>];
  edit: [];
  remove: [];
  /** Glide the canvas to one of `focusSpots` (by key). */
  "show-target": [key: string];
  /** Glide the canvas to one of `lockSpots` (by key) and blink the row. */
  "show-lock": [key: string];
}>();

/** The row's icon and name colours as CSS variables (absent: the theme's). */
const looks = computed(() => {
  const s: Record<string, string> = {};
  if (props.t.icon_color) s["--wp-tg-icon"] = props.t.icon_color;
  if (props.t.text_color) s["--wp-tg-text"] = props.t.text_color;
  return s;
});
/** `tint` stands in for the accent the control is drawn with. Set on the
 *  control only, so the row's own buttons (globe) keep the theme's. */
const tintStyle = computed(() => {
  const c = props.t.tint;
  if (!c) return undefined;
  const s: Record<string, string> = {};
  for (const k of ["--wp-accent", "--wp-accent-text", "--wp-accent-500", "--wp-accent-600", "--check-on"]) s[k] = c;
  return s;
});
/** The control this row draws: Pick one's shared look, else its own style. */
const look = computed<ToggleStyle | "radio">(() => (props.pickOne ? props.pickStyle ?? "radio" : props.t.style));

function blockedHint(): string {
  return props.blocked ? `Turn on "${props.parentName}" first` : "";
}
function sub(): string {
  if (props.parentName) return props.blocked ? `Off: needs ${props.parentName}` : `needs ${props.parentName}`;
  return props.t.var ? `$${props.t.var}` : "no variable";
}
function subClass(): string {
  if (props.parentName) return props.blocked ? "is-warn" : "is-linked";
  return props.t.var ? varColorClass(props.t.var) : "is-dim";
}
function internalHint(): string {
  const v = `$${props.t.var}`;
  return props.t.visible
    ? `${v} shows in the Assembler. Mark internal to keep it for rules only`
    : `Internal: ${v} is for rules only and stays out of the Assembler. Click to show it there`;
}
function flip(): void {
  emit("set-on", !props.shownOn);
}
/** Buttons: a click on the side that's already lit flips it too, so any
 *  click on the pair switches it (the other side goes through the v-model).
 *  Runs in the capture phase, before the kit's own handler: once the unlit
 *  side's pick had re-rendered the row, a bubbling handler saw that side lit
 *  and flipped it straight back, so clicking With did nothing. */
function flipFromLit(e: MouseEvent): void {
  if (props.blocked) return;
  const opt = e.target instanceof Element ? e.target.closest(".wp-segmented__opt") : null;
  if (opt?.getAttribute("data-active") === "true") emit("set-on", !props.t.on);
}

const lockHint = computed(() => {
  const n = props.t.lock_targets?.length ?? 0;
  const what = props.t.lock === "value" ? "the value" : "the seed";
  const rows = `${n} row${n === 1 ? "" : "s"}`;
  return props.effOn ? `Locks ${what} of ${rows} now` : `Locks ${what} of ${rows} while on`;
});
const upstreamHint = computed(() => `Upstream can set it: a yes/no ${props.t.var ? `$${props.t.var}` : "value"} from the Context above switches it`);
const missingHint = computed(() => {
  const gone = props.lockMissing ?? [];
  return `${gone.length} lock target${gone.length === 1 ? " is" : "s are"} missing (${[...new Set(gone)].join(", ")}): the node or row is gone`;
});
</script>

<template>
  <div class="wp-tgr" :class="{ 'is-tile': tile }" :style="indent ? { marginLeft: `${indent}px` } : undefined" :data-wp-vars="t.var || undefined">
    <div
      class="wp-tgr__row"
      :class="{ 'is-blocked': blocked, 'is-on': effOn, 'is-chip': look === 'chip', 'is-editing': editing, 'has-icon-color': !!t.icon_color, 'has-text-color': !!t.text_color }"
      :data-wp-out="!tile && t.pin && t.out ? `toggle_${t.out}` : undefined"
      :data-wp-socket="!tile && hasCtlDot(t) ? ctlInputName(t.id) : undefined"
      :data-test="`tg-row-${t.id}`"
      :style="looks"
    >
      <template v-if="look === 'chip'">
        <span v-tooltip="blocked ? blockedHint() : t.var ? `$${t.var}` : ''" class="wp-tgr__chip" :style="tintStyle">
          <WpSwitch
            :model-value="shownOn"
            variant="chip"
            size="sm"
            :label="t.name"
            :icon="t.icon ? `pi-${t.icon}` : undefined"
            :disabled="blocked"
            :data-test="`tg-ctl-${t.id}`"
            @update:model-value="(v: boolean) => emit('set-on', v)"
          >
            <span class="wp-tgr__chipname">{{ t.name }}</span>
            <template v-if="t.var && !t.hide_var">
              <span class="wp-tgr__chipdot" aria-hidden="true">·</span>
              <span class="wp-tgr__chipvar" :class="varColorClass(t.var)" :data-test="`tg-chip-var-${t.id}`">${{ t.var }}</span>
            </template>
          </WpSwitch>
        </span>
        <span v-if="parentName" class="wp-tgr__sub" :class="subClass()"><i class="pi pi-link" aria-hidden="true" />{{ sub() }}</span>
        <ToggleCtlButton
            v-if="controlState"
            :state="controlState"
            :spots="focusSpots ?? []"
            :toggle-id="t.id"
            @show="(key: string) => emit('show-target', key)"
          />
          <ToggleLockButton
            v-if="t.lock && t.lock_targets?.length"
            :spots="lockSpots ?? []"
            :hint="lockHint"
            :active="effOn"
            :toggle-id="t.id"
            @show="(key: string) => emit('show-lock', key)"
          />
          <i
            v-if="t.upstream"
            v-tooltip="upstreamHint"
            class="pi pi-arrow-down-right wp-tgr__ctlicon wp-tgr__up"
            role="img"
            :aria-label="upstreamHint"
            :data-test="`tg-upstream-icon-${t.id}`"
          />
      </template>
      <template v-else>
      <!-- The icon is a column of its own, centred against the name and
           its $var, so both lines start at the same edge. -->
      <i v-if="t.icon" class="pi wp-tgr__icon" :class="`pi-${t.icon}`" aria-hidden="true" :data-test="`tg-icon-${t.id}`" />
      <span class="wp-tgr__name">
        <span class="wp-tgr__title">
          <b>{{ t.name }}</b>
          <ToggleCtlButton
            v-if="controlState"
            :state="controlState"
            :spots="focusSpots ?? []"
            :toggle-id="t.id"
            @show="(key: string) => emit('show-target', key)"
          />
          <ToggleLockButton
            v-if="t.lock && t.lock_targets?.length"
            :spots="lockSpots ?? []"
            :hint="lockHint"
            :active="effOn"
            :toggle-id="t.id"
            @show="(key: string) => emit('show-lock', key)"
          />
          <i
            v-if="t.upstream"
            v-tooltip="upstreamHint"
            class="pi pi-arrow-down-right wp-tgr__ctlicon wp-tgr__up"
            role="img"
            :aria-label="upstreamHint"
            :data-test="`tg-upstream-icon-${t.id}`"
          />
        </span>
        <span v-if="parentName || !t.hide_var" class="wp-tgr__sub" :class="subClass()">
          <i v-if="parentName" class="pi pi-link" aria-hidden="true" />{{ sub() }}
        </span>
      </span>
      </template>
      <i
        v-if="lockMissing?.length"
        v-tooltip="missingHint"
        class="pi pi-lock wp-tgr__missing"
        role="img"
        :aria-label="missingHint"
        :data-test="`tg-lock-missing-${t.id}`"
      />
      <i
        v-if="problem"
        v-tooltip="problem"
        class="pi pi-exclamation-triangle wp-tgr__warn"
        role="img"
        :aria-label="problem"
      />
      <span v-if="editable" class="wp-tgr__btns">
        <WpIconButton
          icon="pi-pencil"
          :pressed="editing"
          :label="`Edit ${t.name}`"
          :data-test="`tg-edit-${t.id}`"
          @click="emit('edit')"
        />
        <WpIconButton
          v-if="t.var"
          icon="pi-globe"
          tone="accent"
          :pressed="!t.visible"
          :label="t.visible ? 'Mark internal' : 'Unmark internal'"
          :hint="internalHint()"
          :data-test="`tg-internal-${t.id}`"
          @click="emit('patch', { visible: t.visible ? undefined : true })"
        />
        <WpIconButton
          icon="pi-trash"
          tone="danger"
          :label="`Remove ${t.name}`"
          :data-test="`tg-remove-${t.id}`"
          @click="emit('remove')"
        />
      </span>
      <template v-if="look === 'radio'">
        <span
          v-tooltip="shownOn ? 'Picked' : 'Pick this one'"
          role="radio"
          tabindex="0"
          class="wp-tgr__radio"
          :style="tintStyle"
          :class="{ 'is-on': shownOn }"
          :aria-checked="shownOn"
          :aria-label="t.name"
          :data-test="`tg-ctl-${t.id}`"
          @click="flip"
          @keydown.space.prevent.stop="flip"
          @keydown.enter.prevent.stop="flip"
        />
      </template>
      <span v-else-if="look === 'checkbox'" v-tooltip="blockedHint()" class="wp-tgr__ctl" :style="tintStyle">
        <Checkbox
          :model-value="shownOn"
          :disabled="blocked"
          :aria-label="t.name"
          :data-test="`tg-ctl-${t.id}`"
          @update:model-value="(v: boolean) => emit('set-on', v)"
        />
      </span>
      <!-- Only catches clicks on their way to the kit's own option buttons
           (Space / Enter on them fire a click too), so it needs no keys. -->
      <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -->
      <span v-else-if="look === 'buttons'" v-tooltip="blockedHint()" class="wp-tgr__ctl" :style="tintStyle" @click.capture="flipFromLit">
        <WpSegmented
          :model-value="t.on ? 'on' : 'off'"
          :options="[{ value: 'on', label: t.on_label || 'On' }, { value: 'off', label: t.off_label || 'Off' }]"
          size="sm"
          :disabled="blocked"
          :aria-label="t.name"
          :test-prefix="`tg-ctl-${t.id}`"
          @update:model-value="(v: string) => emit('set-on', v === 'on')"
        />
      </span>
      <span v-else-if="look === 'switch'" v-tooltip="blockedHint()" class="wp-tgr__ctl" :style="tintStyle">
        <WpSwitch
          :model-value="shownOn"
          size="sm"
          :disabled="blocked"
          :aria-label="t.name"
          :data-test="`tg-ctl-${t.id}`"
          @update:model-value="(v: boolean) => emit('set-on', v)"
        />
      </span>
    </div>

  </div>
</template>

<style scoped>
.wp-tgr { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.wp-tgr__row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 3px 6px 3px 8px;
  background: var(--wp-bg2, var(--wp-bg-1));
  border-radius: min(4px, var(--wp-radius-cap, 999px));
  box-sizing: border-box;
  min-width: 0;
}
.wp-tgr__row.is-chip { min-height: 26px; padding-left: 4px; }
/* Off because the toggle it needs is off: the Context node's disabled-module
 * stripes. The background stays opaque (only the content dims), so nothing
 * behind the row shows through. */
.wp-tgr__row.is-blocked {
  background: repeating-linear-gradient(
    45deg,
    var(--wp-bg3),
    var(--wp-bg3) 6px,
    var(--wp-bg2) 6px,
    var(--wp-bg2) 8px
  );
  box-shadow: inset 0 0 0 1px var(--wp-border);
}
.wp-tgr__row.is-blocked > * { opacity: 0.55; }
.wp-tgr__row.is-editing { box-shadow: inset 0 0 0 1px var(--wp-accent); }
.wp-tgr__name { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.wp-tgr__name b {
  font-weight: 600;
  font-size: 12px;
  line-height: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-tgr__row.is-blocked .wp-tgr__name b { color: var(--wp-text-muted, var(--wp-text2)); }
/* A chip spans the row (one chip per row, so a narrow one looked lost and
 * was a small target); the needs line and icons keep their size after it. */
.wp-tgr__chip { display: flex; flex: 1 1 0; min-width: 0; }
.wp-tgr__chip :deep(.wp-switch--chip) { width: 100%; min-width: 0; justify-content: center; }
.wp-tgr__row.is-chip .wp-tgr__sub { flex: 0 1 auto; max-width: 50%; }
/* In a grid every tile in a line is as tall as the tallest (a name + var
 * tile), and a chip fills its tile, so a chip next to a switch or a checkbox
 * isn't a smaller box. */
.wp-tgr.is-tile > .wp-tgr__row { flex: 1 1 auto; }
.wp-tgr.is-tile .wp-tgr__row.is-chip { align-items: stretch; }
.wp-tgr.is-tile .wp-tgr__chip :deep(.wp-switch--chip) { height: auto; min-height: var(--wp-control-h-sm); }
.wp-tgr__sub {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font: 10.5px/14px var(--wp-font-mono, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wp-tgr__sub .pi { font-size: 9px; }
.wp-tgr__sub.is-linked { font-family: var(--wp-font-sans, sans-serif); color: var(--wp-text-muted, var(--wp-text2)); }
.wp-tgr__sub.is-linked .pi { color: var(--wp-accent); }
.wp-tgr__sub.is-warn { font-family: var(--wp-font-sans, sans-serif); color: var(--wp-amber, var(--wp-warn)); }
.wp-tgr__sub.is-dim { font-family: var(--wp-font-sans, sans-serif); font-style: italic; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-tgr__title { display: flex; align-items: center; gap: 5px; min-width: 0; }
/* A fixed box with the glyph centred in it: the icon font's own line box sat
 * the glyph a pixel or two off the name's middle. */
.wp-tgr__icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 13px;
  line-height: 1;
  color: var(--wp-tg-icon, var(--wp-text-muted, var(--wp-text2)));
}
/* The chip says "Name · $var" (the var when Show is on). */
.wp-tgr__chipname {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 16px;
  color: var(--wp-tg-text, inherit);
}
/* A name colour carries over to its variable (row line and chip). */
.wp-tgr__row.has-text-color .wp-tgr__chipvar,
.wp-tgr__row.has-text-color .wp-tgr__sub:not(.is-linked):not(.is-warn) { color: var(--wp-tg-text); }
.wp-tgr__chipdot { flex: none; line-height: 16px; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-tgr__chipvar {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 10.5px/16px var(--wp-font-mono, monospace);
}
.wp-tgr__chip :deep(.wp-switch--chip .wp-switch__icon) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 16px;
  line-height: 1;
}
.wp-tgr__name b { color: var(--wp-tg-text, inherit); }
/* Own colours win over the chip's lit accent, so a yellow sun stays yellow. */
.wp-tgr__row.has-icon-color .wp-tgr__chip :deep(.wp-switch--chip .wp-switch__icon) { color: var(--wp-tg-icon); }
.wp-tgr__btns { display: inline-flex; align-items: center; gap: 2px; flex: none; }
/* Mute / bypass icon: dim while it isn't acting, coloured while it is
 * (bypass in the host's bypass violet, mute in amber). */
/* Buttons: a picked On lights up in the accent like a switch's track, so the
   toggle's control colour (tint) shows; a picked Off stays neutral. */
.wp-tgr__ctl :deep(.wp-segmented__opt[data-active="true"]:first-child) {
  background: color-mix(in srgb, var(--wp-accent) 18%, var(--wp-bg-4));
  color: var(--wp-accent-text);
  box-shadow: var(--wp-shadow-sm), inset 0 0 0 1px var(--wp-accent);
}
.wp-tgr__ctlicon { flex: none; font-size: 10px; color: var(--wp-text-dim, var(--wp-text3)); opacity: 0.7; }
/* A grid chip stretches to its tile's height; the icons after it stay on
 * the chip's middle instead of riding up to the tile's top. */
.wp-tgr__row.is-chip > :deep(.wp-tgr__ctlicon),
.wp-tgr__row.is-chip > :deep(.wp-dropdown-anchor),
.wp-tgr__row.is-chip > .wp-tgr__sub { align-self: center; }
.wp-tgr__ctlicon.is-active { opacity: 1; }
.wp-tgr__ctlicon.is-active.is-bypass { color: var(--wp-violet); }
.wp-tgr__ctlicon.is-active.is-mute { color: var(--wp-amber, var(--wp-warn)); }
.wp-tgr__up { font-size: 10px; opacity: 0.85; }
.wp-tgr__ctlicon.is-active.is-lock { color: var(--wp-accent); }
.wp-tgr__missing { font-size: 11px; color: var(--wp-red, var(--wp-danger)); }
.wp-tgr__warn { font-size: 11px; color: var(--wp-amber, var(--wp-warn)); }
.wp-tgr__ctl { display: inline-flex; flex: none; }
.wp-tgr__radio {
  flex: none;
  position: relative;
  width: 18px;
  height: 18px;
  margin: 0 3px;
  border-radius: 50%;
  box-sizing: border-box;
  border: 2px solid var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
}
/* The click reaches 24 x 24, like ComfyUI's row controls (::after is the dot). */
.wp-tgr__radio::before { content: ""; position: absolute; inset: -5px; }
.wp-tgr__radio.is-on { border-color: var(--wp-accent); }
.wp-tgr__radio.is-on::after {
  content: "";
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: var(--wp-accent);
}
.wp-tgr__radio:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus, var(--wp-accent)); }

</style>
