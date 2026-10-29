<script setup lang="ts">
/**
 * One toggle row of WP Toggles, plus its edit panel when open. Stateless:
 * the parent (`TogglesWidget.vue`) works out every fact shown here and
 * applies every change this emits.
 *
 * The row carries `data-wp-out="toggle_<out>"` while it has an output, so
 * `extension/row-outputs.ts` puts that BOOLEAN dot at the row's right edge.
 */
import WpButton from "../../kit/WpButton.vue";
import WpIconButton from "../../kit/WpIconButton.vue";
import WpSegmented from "../../kit/WpSegmented.vue";
import WpSwitch from "../../kit/WpSwitch.vue";
import WpCheck from "../../kit/WpCheck.vue";
import WpSelect from "../../kit/WpSelect.vue";
import CloseButton from "../../kit/CloseButton.vue";
import Combobox from "../../kit/Combobox.vue";
import { vTooltip } from "../../kit/tooltip";
import { varColorClass } from "../shared/var-color";
import type { ToggleControl, ToggleRow, ToggleStyle } from "../../extension/toggles";
import { ctlInputName, type ControlState } from "../../extension/toggle-control";

interface Choice { value: string; label: string }

const props = defineProps<{
  t: ToggleRow;
  /** Pick one mode: a radio instead of the style's control. */
  pickOne: boolean;
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
}>();

const emit = defineEmits<{
  "set-on": [on: boolean];
  patch: [patch: Partial<ToggleRow>];
  rename: [name: string];
  "set-var": [v: string];
  edit: [];
  "move-group": [labelId: string];
  remove: [];
}>();

const CONTROLS = [
  { value: "", label: "Nothing", hint: "Off only writes false and sends False" },
  { value: "mute", label: "Mute", hint: "Off also mutes the nodes wired into the dot in front of the row" },
  { value: "bypass", label: "Bypass", hint: "Off also bypasses the nodes wired into the dot in front of the row" },
];
function setControl(v: string): void {
  emit("patch", v ? { control: v as ToggleControl } : { control: undefined, groups: undefined });
}
function setGroups(v: string[] | string | null): void {
  const list = Array.isArray(v) ? v : [];
  emit("patch", { groups: list.length ? list : undefined });
}

const STYLES: { value: ToggleStyle; label: string; hint: string }[] = [
  { value: "switch", label: "Switch", hint: "A sliding switch" },
  { value: "checkbox", label: "Check", hint: "A checkbox" },
  { value: "buttons", label: "Buttons", hint: "Two buttons with your own words, e.g. Day / Night" },
  { value: "chip", label: "Chip", hint: "A small chip with the name, lit when on" },
];

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
function value(ev: Event): string {
  return (ev.target as HTMLInputElement).value.trim();
}
function flip(): void {
  emit("set-on", !props.shownOn);
}
</script>

<template>
  <div class="wp-tgr" :style="indent ? { marginLeft: `${indent}px` } : undefined">
    <div
      class="wp-tgr__row"
      :class="{ 'is-blocked': blocked, 'is-on': effOn, 'is-chip': t.style === 'chip' && !pickOne, 'is-editing': editing }"
      :data-wp-out="t.pin && t.out ? `toggle_${t.out}` : undefined"
      :data-wp-socket="t.control ? ctlInputName(t.id) : undefined"
      :data-test="`tg-row-${t.id}`"
    >
      <template v-if="t.style === 'chip' && !pickOne">
        <span v-tooltip="blocked ? blockedHint() : t.var ? `$${t.var}` : ''" class="wp-tgr__chip">
          <WpSwitch
            :model-value="shownOn"
            variant="chip"
            size="sm"
            :label="t.name"
            :disabled="blocked"
            :data-test="`tg-ctl-${t.id}`"
            @update:model-value="(v: boolean) => emit('set-on', v)"
          />
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
        <span v-if="editable || parentName || !t.hide_var" class="wp-tgr__sub" :class="subClass()">
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
      <WpIconButton
        v-if="editable"
        icon="pi-pencil"
        :pressed="editing"
        :label="`Edit ${t.name}`"
        :data-test="`tg-edit-${t.id}`"
        @click="emit('edit')"
      />
      <template v-if="pickOne">
        <span
          v-tooltip="shownOn ? 'Picked' : 'Pick this one'"
          role="radio"
          tabindex="0"
          class="wp-tgr__radio"
          :class="{ 'is-on': shownOn }"
          :aria-checked="shownOn"
          :aria-label="t.name"
          :data-test="`tg-ctl-${t.id}`"
          @click="flip"
          @keydown.space.prevent.stop="flip"
          @keydown.enter.prevent.stop="flip"
        />
      </template>
      <span v-else-if="t.style === 'checkbox'" v-tooltip="blockedHint()" class="wp-tgr__ctl">
        <WpCheck
          :model-value="t.on"
          :disabled="blocked"
          :aria-label="t.name"
          :data-test="`tg-ctl-${t.id}`"
          @update:model-value="(v: boolean) => emit('set-on', v)"
        />
      </span>
      <span v-else-if="t.style === 'buttons'" v-tooltip="blockedHint()" class="wp-tgr__ctl">
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
      <span v-else-if="t.style === 'switch'" v-tooltip="blockedHint()" class="wp-tgr__ctl">
        <WpSwitch
          :model-value="t.on"
          size="sm"
          :disabled="blocked"
          :aria-label="t.name"
          :data-test="`tg-ctl-${t.id}`"
          @update:model-value="(v: boolean) => emit('set-on', v)"
        />
      </span>
    </div>

    <div v-if="editable && editing" class="wp-tgr__edit" :data-test="`tg-editor-${t.id}`">
      <div class="wp-tgr__edit-head">
        <span class="wp-tgr__cap">EDIT TOGGLE</span>
        <CloseButton size="sm" label="Done" @click="emit('edit')" />
      </div>
      <label class="wp-tgr__field">
        <span>Name <em>on the row and its output</em></span>
        <input :value="t.name" spellcheck="false" data-test="tg-name" @keydown.stop @change="emit('rename', value($event))">
      </label>
      <label class="wp-tgr__field">
        <span>Variable <em>true or false, for rules only</em></span>
        <span class="wp-tgr__var-row">
        <span class="wp-vbind-wrap" :class="{ 'wp-vbind-wrap--collision-warn': !!problem }">
          <span class="wp-vbind-prefix">$</span>
          <input
            class="wp-vbind-input"
            :class="t.var ? varColorClass(t.var) : undefined"
            :value="t.var"
            placeholder="variable_name"
            spellcheck="false"
            data-test="tg-var"
            @keydown.stop
            @change="emit('set-var', value($event).replace(/^\$/, ''))"
          >
        </span>
        <span v-tooltip="'Show the $variable under the name in the clean view'" class="wp-tgr__check">
          <WpCheck
            :model-value="!t.hide_var"
            size="sm"
            aria-label="Show in clean view"
            data-test="tg-show-var"
            @update:model-value="(v: boolean) => emit('patch', { hide_var: v ? undefined : true })"
          />
          <span aria-hidden="true">Show</span>
        </span>
        </span>
      </label>
      <label v-if="pickOne" class="wp-tgr__field">
        <span>Value <em>picked variable gets this, not the name</em></span>
        <input
          :value="t.value ?? ''"
          :placeholder="t.name"
          spellcheck="false"
          data-test="tg-value"
          @keydown.stop
          @change="emit('patch', { value: ($event.target as HTMLInputElement).value || undefined })"
        >
      </label>
      <div class="wp-tgr__field">
        <span>Style</span>
        <WpSegmented
          :model-value="t.style"
          :options="STYLES"
          size="sm"
          block
          aria-label="Style"
          test-prefix="tg-style"
          @update:model-value="(v: ToggleStyle) => emit('patch', { style: v })"
        />
      </div>
      <div v-if="t.style === 'buttons'" class="wp-tgr__two">
        <label class="wp-tgr__field">
          <span>On word</span>
          <input :value="t.on_label ?? ''" placeholder="On" data-test="tg-on-label" @keydown.stop @change="emit('patch', { on_label: value($event) || undefined })">
        </label>
        <label class="wp-tgr__field">
          <span>Off word</span>
          <input :value="t.off_label ?? ''" placeholder="Off" data-test="tg-off-label" @keydown.stop @change="emit('patch', { off_label: value($event) || undefined })">
        </label>
      </div>
      <div class="wp-tgr__field">
        <span>Needs <em>{{ pickOne ? "not used while Pick one is on" : "only on while that toggle is on" }}</em></span>
        <WpSelect
          :model-value="t.needs ?? ''"
          :options="needsOptions"
          aria-label="Needs"
          data-test="tg-needs"
          :disabled="pickOne"
          @update:model-value="(v: string) => emit('patch', { needs: v || undefined })"
        />
      </div>
      <div class="wp-tgr__field">
        <span>When off <em>also mute or bypass other nodes</em></span>
        <WpSegmented
          :model-value="t.control ?? ''"
          :options="CONTROLS"
          size="sm"
          block
          aria-label="When off"
          test-prefix="tg-control"
          @update:model-value="setControl"
        />
      </div>
      <span v-if="t.control" v-tooltip="'Mute or bypass while the toggle is ON instead, for a node used only as a switchboard'" class="wp-tgr__check">
        <WpCheck
          :model-value="!!t.invert"
          size="sm"
          aria-label="Invert"
          data-test="tg-invert"
          @update:model-value="(v: boolean) => emit('patch', { invert: v ? true : undefined })"
        />
        <span aria-hidden="true">Invert: {{ t.control === "mute" ? "mute" : "bypass" }} while on</span>
      </span>
      <div v-if="t.control" class="wp-tgr__field">
        <span>Canvas groups <em>wire nodes into the dot in front of the row, or pick groups</em></span>
        <Combobox
          :model-value="t.groups ?? []"
          multiple
          :options="(canvasGroups ?? []).map((g) => ({ value: g, label: g }))"
          placeholder="No groups"
          size="sm"
          aria-label="Canvas groups"
          data-test="tg-groups"
          @update:model-value="setGroups"
        />
      </div>
      <span v-tooltip="'When the upstream Context holds this variable as a yes/no word (true, on, 1, no …), it sets the switch'" class="wp-tgr__check">
        <WpCheck
          :model-value="!!t.upstream"
          size="sm"
          aria-label="Upstream can set it"
          data-test="tg-upstream"
          @update:model-value="(v: boolean) => emit('patch', { upstream: v ? true : undefined })"
        />
        <span aria-hidden="true">Upstream can set it</span>
      </span>
      <div v-if="groupOptions.length" class="wp-tgr__field">
        <span>Group</span>
        <WpSelect
          :model-value="groupId"
          :options="groupOptions"
          aria-label="Group"
          data-test="tg-group"
          @update:model-value="(v: string) => emit('move-group', v)"
        />
      </div>
      <div class="wp-tgr__edit-foot">
        <span v-tooltip="!t.pin && outputsFull ? 'All 16 outputs are in use' : 'Show a BOOLEAN output for switch nodes'" class="wp-tgr__check">
          <WpCheck
            :model-value="t.pin"
            size="sm"
            :disabled="!t.pin && outputsFull"
            aria-label="BOOLEAN output"
            data-test="tg-pin"
            @update:model-value="(v: boolean) => emit('patch', { pin: v })"
          />
          <span aria-hidden="true">BOOLEAN output</span>
        </span>
        <span class="wp-tgr__foot-btns">
          <WpButton variant="ghost" size="sm" icon="pi-trash" data-test="tg-delete" @click="emit('remove')">Remove</WpButton>
          <WpButton variant="primary" size="sm" icon="pi-check" data-test="tg-done" @click="emit('edit')">Done</WpButton>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import "../shared/var-binding-input.css";
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
.wp-tgr__chip { display: inline-flex; min-width: 0; }
.wp-tgr__row.is-chip .wp-tgr__sub { flex: 1; }
.wp-tgr__row.is-chip:not(:has(.wp-tgr__sub)) .wp-tgr__chip { margin-right: auto; }
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
/* Mute / bypass icon: dim while it isn't acting, coloured while it is
 * (bypass in the host's bypass violet, mute in amber). */
.wp-tgr__ctlicon { flex: none; font-size: 10px; color: var(--wp-text-dim, var(--wp-text3)); opacity: 0.7; }
.wp-tgr__ctlicon.is-active { opacity: 1; }
.wp-tgr__ctlicon.is-active.is-bypass { color: var(--wp-violet); }
.wp-tgr__ctlicon.is-active.is-mute { color: var(--wp-amber, var(--wp-warn)); }
.wp-tgr__var-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wp-tgr__up { font-size: 9px; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-tgr__warn { font-size: 11px; color: var(--wp-amber, var(--wp-warn)); }
.wp-tgr__ctl { display: inline-flex; flex: none; }
.wp-tgr__radio {
  flex: none;
  position: relative;
  width: 16px;
  height: 16px;
  margin: 0 2px;
  border-radius: 50%;
  box-sizing: border-box;
  border: 2px solid var(--wp-text-dim, var(--wp-text3));
  cursor: pointer;
}
.wp-tgr__radio.is-on { border-color: var(--wp-accent); }
.wp-tgr__radio.is-on::after {
  content: "";
  position: absolute;
  inset: 2px;
  border-radius: 50%;
  background: var(--wp-accent);
}
.wp-tgr__radio:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--wp-border-focus, var(--wp-accent)); }

/* Edit panel */
.wp-tgr__edit {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: var(--wp-bg-deep, var(--wp-bg));
  border: 1px solid var(--wp-border);
  border-radius: min(4px, var(--wp-radius-cap, 999px));
}
.wp-tgr__edit-head { display: flex; align-items: center; justify-content: space-between; }
.wp-tgr__cap {
  font: 600 9px var(--wp-font-sans, sans-serif);
  letter-spacing: 0.08em;
  color: var(--wp-text-dim, var(--wp-text-muted, var(--wp-text2)));
}
.wp-tgr__field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.wp-tgr__field > span { font-size: 10.5px; font-weight: 600; color: var(--wp-text-muted, var(--wp-text2)); }
.wp-tgr__field em { font-style: normal; font-weight: 400; color: var(--wp-text-dim, var(--wp-text3)); margin-left: 4px; }
.wp-tgr__field input:not(.wp-vbind-input) {
  min-width: 0;
  height: var(--wp-control-h-sm, 24px);
  padding: 0 8px;
  box-sizing: border-box;
  background: var(--wp-bg);
  color: var(--wp-text);
  border: 1px solid var(--wp-border);
  border-radius: min(3px, var(--wp-radius-cap, 999px));
  font: 12px var(--wp-font-sans, sans-serif);
  outline: none;
}
.wp-tgr__field input:not(.wp-vbind-input):focus { border-color: var(--wp-accent); }
.wp-tgr__field input:not(.wp-vbind-input).is-problem { border-color: var(--wp-amber, var(--wp-warn)); }
.wp-tgr__two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
.wp-tgr__edit-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.wp-tgr__foot-btns { display: inline-flex; align-items: center; gap: 6px; }
.wp-tgr__check { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer; }
</style>
