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
import WpSegmented from "@/kit/WpSegmented.vue";
import WpSwitch from "@/kit/WpSwitch.vue";
import Checkbox from "@/kit/Checkbox.vue";
import { vTooltip } from "@/kit/tooltip";
import { varColorClass } from "../shared/var-color";
import { computed } from "vue";
import type { PickStyle, ToggleRow, ToggleStyle } from "../../extension/toggles";
import { ctlInputName, type ControlState } from "../../extension/toggle-control";
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
  /** Canvas group titles to offer in the edit panel. */
  canvasGroups?: string[];
  /** `$` suggestions for the Pick one Value: upstream + the toggles' own. */
  varSuggestions?: string[];
  /** Who writes each upstream `$var`, for the Value's chip hover card. */
  varProducers?: Map<string, VarProducerLike> | undefined;
}>();

const emit = defineEmits<{
  "set-on": [on: boolean];
  patch: [patch: Partial<ToggleRow>];
  edit: [];
  remove: [];
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
</script>

<template>
  <div class="wp-tgr" :style="indent ? { marginLeft: `${indent}px` } : undefined">
    <div
      class="wp-tgr__row"
      :class="{ 'is-blocked': blocked, 'is-on': effOn, 'is-chip': look === 'chip', 'is-editing': editing, 'has-icon-color': !!t.icon_color, 'has-text-color': !!t.text_color }"
      :data-wp-out="t.pin && t.out ? `toggle_${t.out}` : undefined"
      :data-wp-socket="t.control ? ctlInputName(t.id) : undefined"
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
        <i
            v-if="controlState"
            v-tooltip="controlState.hint"
            class="pi wp-tgr__ctlicon"
            :class="[controlState.control === 'mute' ? 'pi-volume-off' : 'pi-forward', `is-${controlState.control}`, { 'is-active': controlState.active }]"
            role="img"
            :aria-label="controlState.hint"
          />
      </template>
      <span v-else class="wp-tgr__name">
        <span class="wp-tgr__title">
          <i v-if="t.icon" class="pi wp-tgr__icon" :class="`pi-${t.icon}`" aria-hidden="true" />
          <b>{{ t.name }}</b>
          <i
            v-if="controlState"
            v-tooltip="controlState.hint"
            class="pi wp-tgr__ctlicon"
            :class="[controlState.control === 'mute' ? 'pi-volume-off' : 'pi-forward', `is-${controlState.control}`, { 'is-active': controlState.active }]"
            role="img"
            :aria-label="controlState.hint"
          />
        </span>
        <span v-if="parentName || !t.hide_var" class="wp-tgr__sub" :class="subClass()">
          <i v-if="parentName" class="pi pi-link" aria-hidden="true" />{{ sub() }}
          <i v-if="t.upstream" v-tooltip="'Upstream can set it'" class="pi pi-arrow-down-right wp-tgr__up" aria-label="Upstream can set it" />
        </span>
      </span>
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
      <span v-else-if="look === 'buttons'" v-tooltip="blockedHint()" class="wp-tgr__ctl" :style="tintStyle">
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
  width: 14px;
  height: 16px;
  font-size: 12px;
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
.wp-tgr__ctlicon { flex: none; font-size: 10px; color: var(--wp-text-dim, var(--wp-text3)); opacity: 0.7; }
.wp-tgr__ctlicon.is-active { opacity: 1; }
.wp-tgr__ctlicon.is-active.is-bypass { color: var(--wp-violet); }
.wp-tgr__ctlicon.is-active.is-mute { color: var(--wp-amber, var(--wp-warn)); }
.wp-tgr__up { font-size: 9px; color: var(--wp-text-dim, var(--wp-text3)); }
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
