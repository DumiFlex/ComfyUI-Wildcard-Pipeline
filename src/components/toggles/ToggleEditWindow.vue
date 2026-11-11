<script setup lang="ts">
/**
 * One WP Toggles toggle's settings, in a window (`NodeEditWindow`): the node
 * keeps its edit view (mode, order, globe, remove, labels) and the row's
 * pencil opens this. It edits a draft of the row; Done hands the draft and
 * its group back to `TogglesWidget.vue`, which stores it (a name change
 * carries a variable that followed the old name along). The strip on top is
 * the row as the node will draw it.
 */
import { computed, defineAsyncComponent, ref } from "vue";
import Input from "@/kit/Input.vue";
import WpSegmented from "@/kit/WpSegmented.vue";
import Checkbox from "@/kit/Checkbox.vue";
import WpSelect from "@/kit/WpSelect.vue";
import Combobox from "@/kit/Combobox.vue";
import ColorField from "@/kit/ColorField.vue";
import IconSwatch from "./IconSwatch.vue";
import { vTooltip } from "@/kit/tooltip";
import { vToggleRow } from "@/kit/toggle-row";
import NodeEditWindow from "../shared/NodeEditWindow.vue";
import ToggleRowView from "./ToggleRow.vue";
import { varColorClass } from "../shared/var-color";
import type { PickStyle, ToggleControl, ToggleRow, ToggleStyle } from "../../extension/toggles";
import type { ControlState } from "../../extension/toggle-control";
import type { VarProducerLike } from "../../manager/components/RefChip.vue";
import { INLINE_PICKS_NOTE, hasInlinePicks, tokenize } from "../context/editors/_shared/preview-tokens";

const RichTextInput = defineAsyncComponent(() => import("../../manager/components/RichTextInput.vue"));
const NegativeField = defineAsyncComponent(() => import("../../manager/components/NegativeField.vue"));

interface Choice { value: string; label: string }

const props = defineProps<{
  t: ToggleRow;
  pickOne: boolean;
  pickStyle?: PickStyle | undefined;
  shownOn: boolean;
  effOn: boolean;
  parentName: string;
  blocked: boolean;
  problem?: string | undefined;
  needsOptions: Choice[];
  /** Label groups to move to; empty hides the field. */
  groupOptions: Choice[];
  groupId: string;
  /** All 16 outputs are taken (an unpinned toggle can't get one). */
  outputsFull: boolean;
  controlState?: ControlState | null | undefined;
  canvasGroups?: string[] | undefined;
  varSuggestions?: string[] | undefined;
  varProducers?: Map<string, VarProducerLike> | undefined;
  nodeTitle?: string | undefined;
}>();
const emit = defineEmits<{ done: [next: ToggleRow, groupId: string]; cancel: [] }>();

// Plain copies: the props are reactive proxies.
const d = ref<ToggleRow>(JSON.parse(JSON.stringify(props.t)) as ToggleRow);
const draftGroup = ref(props.groupId);
const dirty = computed(() => JSON.stringify(d.value) !== JSON.stringify(props.t) || draftGroup.value !== props.groupId);

function patch(p: Partial<ToggleRow>): void {
  const next: Record<string, unknown> = { ...d.value, ...p };
  // An undefined field is stored as absent.
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  d.value = next as unknown as ToggleRow;
}
function value(ev: Event): string {
  return (ev.target as HTMLInputElement).value.trim();
}

const CONTROLS = [
  { value: "", label: "Nothing", hint: "Off only writes false and sends False" },
  { value: "mute", label: "Mute", hint: "Off also mutes the nodes wired into the dot in front of the row" },
  { value: "bypass", label: "Bypass", hint: "Off also bypasses the nodes wired into the dot in front of the row" },
];
function setControl(v: string): void {
  patch(v ? { control: v as ToggleControl } : { control: undefined, groups: undefined });
}
function setGroups(v: string[] | string | null): void {
  const list = Array.isArray(v) ? v : [];
  patch({ groups: list.length ? list : undefined });
}

const STYLES: { value: ToggleStyle; label: string; hint: string }[] = [
  { value: "switch", label: "Switch", hint: "A sliding switch" },
  { value: "checkbox", label: "Check", hint: "A checkbox" },
  { value: "buttons", label: "Buttons", hint: "Two buttons with your own words, e.g. Day / Night" },
  { value: "chip", label: "Chip", hint: "A small chip with the name, lit when on" },
];

/** `$names` the Pick one Value reads that nothing upstream (nor this node)
 *  sets. Only with a graph to look at (`varSuggestions` given). */
const missingVars = computed(() => {
  const known = props.varSuggestions;
  if (!props.pickOne || !known || !d.value.value?.includes("$")) return [];
  const names = tokenize(d.value.value, "assembler")
    .filter((tok) => tok.kind === "var" && tok.varName)
    .map((tok) => tok.varName ?? "");
  return [...new Set(names)].filter((n) => !known.includes(n));
});
const missingNote = computed(() => {
  const list = missingVars.value.map((v) => "$" + v).join(", ");
  return missingVars.value.length > 1
    ? `${list}: nothing upstream sets these, so they print nothing`
    : `${list}: nothing upstream sets this, so it prints nothing`;
});

/** A colour field's value: the colour, or `none`. */
function colorValue(v: string | undefined): string {
  return v ?? "none";
}
/** A colour field's pick as a stored colour (`none` clears it). */
function pickColor(v: string): string | undefined {
  const c = v.slice(0, 7).toLowerCase();
  return /^#[0-9a-f]{6}$/.test(c) ? c : undefined;
}

/** The preview's switch: Any on shows (and flips) the draft's own choice. */
const previewOn = computed(() => (props.pickOne ? props.shownOn : d.value.on));
function previewSet(on: boolean): void {
  if (!props.pickOne) patch({ on });
}
</script>

<template>
  <NodeEditWindow
    :title="nodeTitle || 'WP Toggles'"
    chip="Toggle"
    :sub="d.var ? `${d.name} · $${d.var}` : d.name"
    icon="sliders-h"
    :dirty="dirty"
    :width="520"
    flush
    @done="emit('done', d, draftGroup)"
    @cancel="emit('cancel')"
  >
    <div class="wp-tgw__preview" data-test="tg-window-preview">
      <span class="wp-tgw__cap">ON THE NODE</span>
      <ToggleRowView
        :t="d"
        :pick-one="pickOne"
        :pick-style="pickStyle"
        :shown-on="previewOn"
        :eff-on="pickOne ? effOn : d.on && !blocked"
        :parent-name="parentName"
        :blocked="blocked"
        :indent="0"
        :editing="false"
        :needs-options="[]"
        :group-options="[]"
        group-id=""
        :outputs-full="outputsFull"
        :editable="false"
        :control-state="controlState"
        @set-on="previewSet"
      />
    </div>
    <div class="wp-tgw__body">
      <div class="wp-tgr__edit" :data-test="`tg-editor-${d.id}`">
        <label class="wp-tgr__field">
          <span>Name <em>on the row and its output</em></span>
          <Input size="sm" :model-value="d.name" spellcheck="false" data-test="tg-name" @keydown.stop @change="patch({ name: value($event) })" />
        </label>
        <label class="wp-tgr__field">
          <span>Variable <em>true or false; the globe keeps it internal</em></span>
          <span class="wp-tgr__var-row">
          <Input
            size="sm"
            mono
            prefix="$"
            class="wp-tgr__var"
            :class="d.var ? varColorClass(d.var) : undefined"
            :tone="problem ? 'warn' : undefined"
            :model-value="d.var"
            placeholder="variable_name"
            spellcheck="false"
            data-test="tg-var"
            @keydown.stop
            @change="patch({ var: value($event).replace(/^\$/, '') })"
          />
          <span v-tooltip="'Show the $variable under the name'" v-toggle-row class="wp-tgr__check">
            <Checkbox
              :model-value="!d.hide_var"
              size="sm"
              aria-label="Show the variable under the name"
              data-test="tg-show-var"
              @update:model-value="(v: boolean) => patch({ hide_var: v ? undefined : true })"
            />
            <span aria-hidden="true">Show</span>
          </span>
          </span>
        </label>
        <div class="wp-tgr__field">
          <span>Looks <em>icon and colours; None keeps the theme's</em></span>
          <span class="wp-tgr__looks">
            <span class="wp-tgr__look">
              <IconSwatch
                :model-value="d.icon ?? null"
                :color="d.icon_color"
                aria-label="Icon"
                data-test="tg-icon"
                @update:model-value="(v: string | null) => patch({ icon: v || undefined })"
              />
              <ColorField :model-value="colorValue(d.icon_color)" allow-none presets compact aria-label="Icon colour" data-test="tg-icon-color" @update:model-value="(v: string) => patch({ icon_color: pickColor(v) })" />
              Icon
            </span>
            <span class="wp-tgr__look">
              <ColorField :model-value="colorValue(d.text_color)" allow-none presets compact aria-label="Name colour" data-test="tg-text-color" @update:model-value="(v: string) => patch({ text_color: pickColor(v) })" />
              Name
            </span>
            <span class="wp-tgr__look">
              <ColorField :model-value="colorValue(d.tint)" allow-none presets compact aria-label="Control colour" data-test="tg-tint" @update:model-value="(v: string) => patch({ tint: pickColor(v) })" />
              Control
            </span>
          </span>
        </div>
        <div v-if="pickOne" class="wp-tgr__field">
          <span>Value <em>picked variable gets this, not the name</em></span>
          <RichTextInput
            class="wp-tgr__value"
            :model-value="d.value ?? ''"
            surface="combine"
            multiline
            :rows="2"
            :placeholder="d.name"
            :var-suggestions="varSuggestions ?? []"
            :var-producers="varProducers"
            :graph-aware="!!varProducers"
            aria-label="Value"
            data-test="tg-value"
            @update:model-value="(v: string) => patch({ value: v.trim() ? v : undefined })"
          />
          <p v-if="missingVars.length" class="wp-tgr__note" data-test="tg-missing-vars">
            <i class="pi pi-exclamation-triangle" aria-hidden="true" />{{ missingNote }}
          </p>
          <p v-if="hasInlinePicks(d.value ?? '')" class="wp-tgr__note" data-test="tg-inline-picks">
            <i class="pi pi-exclamation-triangle" aria-hidden="true" />{{ INLINE_PICKS_NOTE }}
          </p>
          <NegativeField
            :model-value="d.negative"
            surface="combine"
            label="toggle"
            test-id="tg-negative"
            :var-suggestions="varSuggestions ?? []"
            :var-producers="varProducers"
            :graph-aware="!!varProducers"
            @update:model-value="(v: string | undefined) => patch({ negative: v })"
          />
        </div>
        <div v-if="!pickOne" class="wp-tgr__field">
          <span>Style</span>
          <WpSegmented
            :model-value="d.style"
            :options="STYLES"
            size="sm"
            block
            aria-label="Style"
            test-prefix="tg-style"
            @update:model-value="(v: ToggleStyle) => patch({ style: v })"
          />
        </div>
        <div v-if="d.style === 'buttons' && !pickOne" class="wp-tgr__two">
          <label class="wp-tgr__field">
            <span>On word</span>
            <Input size="sm" :model-value="d.on_label ?? ''" placeholder="On" data-test="tg-on-label" @keydown.stop @change="patch({ on_label: value($event) || undefined })" />
          </label>
          <label class="wp-tgr__field">
            <span>Off word</span>
            <Input size="sm" :model-value="d.off_label ?? ''" placeholder="Off" data-test="tg-off-label" @keydown.stop @change="patch({ off_label: value($event) || undefined })" />
          </label>
        </div>
        <div v-if="!pickOne" class="wp-tgr__field">
          <span>Needs <em>only on while that toggle is on</em></span>
          <WpSelect
            :model-value="d.needs ?? ''"
            :options="needsOptions"
            aria-label="Needs"
            data-test="tg-needs"
            @update:model-value="(v: string) => patch({ needs: v || undefined })"
          />
        </div>
        <div class="wp-tgr__field">
          <span>When off <em>also mute or bypass other nodes</em></span>
          <WpSegmented
            :model-value="d.control ?? ''"
            :options="CONTROLS"
            size="sm"
            block
            aria-label="When off"
            test-prefix="tg-control"
            @update:model-value="setControl"
          />
        </div>
        <span v-if="d.control" v-tooltip="'Mute or bypass while the toggle is ON instead, for a node used only as a switchboard'" v-toggle-row class="wp-tgr__check">
          <Checkbox
            :model-value="!!d.invert"
            size="sm"
            aria-label="Invert"
            data-test="tg-invert"
            @update:model-value="(v: boolean) => patch({ invert: v ? true : undefined })"
          />
          <span aria-hidden="true">Invert: {{ d.control === "mute" ? "mute" : "bypass" }} while on</span>
        </span>
        <div v-if="d.control" class="wp-tgr__field">
          <span>Canvas groups <em>wire nodes into the dot in front of the row, or pick groups</em></span>
          <Combobox
            :model-value="d.groups ?? []"
            multiple
            :options="(canvasGroups ?? []).map((g) => ({ value: g, label: g }))"
            placeholder="No groups"
            size="sm"
            aria-label="Canvas groups"
            data-test="tg-groups"
            @update:model-value="setGroups"
          />
        </div>
        <span v-tooltip="'When the upstream Context holds this variable as a yes/no word (true, on, 1, no …), it sets the switch'" v-toggle-row class="wp-tgr__check">
          <Checkbox
            :model-value="!!d.upstream"
            size="sm"
            aria-label="Upstream can set it"
            data-test="tg-upstream"
            @update:model-value="(v: boolean) => patch({ upstream: v ? true : undefined })"
          />
          <span aria-hidden="true">Upstream can set it</span>
        </span>
        <div v-if="groupOptions.length" class="wp-tgr__field">
          <span>Group</span>
          <WpSelect
            :model-value="draftGroup"
            :options="groupOptions"
            aria-label="Group"
            data-test="tg-group"
            @update:model-value="(v: string) => (draftGroup = v)"
          />
        </div>
        <div class="wp-tgr__edit-foot">
          <span v-tooltip="!d.pin && outputsFull ? 'All 16 outputs are in use' : 'Show a BOOLEAN output for switch nodes'" v-toggle-row class="wp-tgr__check">
            <Checkbox
              :model-value="d.pin"
              size="sm"
              :disabled="!d.pin && outputsFull"
              aria-label="BOOLEAN output"
              data-test="tg-pin"
              @update:model-value="(v: boolean) => patch({ pin: v })"
            />
            <span aria-hidden="true">BOOLEAN output</span>
          </span>
        </div>
      </div>
    </div>
  </NodeEditWindow>
</template>

<style scoped>
.wp-tgw__preview { display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; flex-shrink: 0; border-bottom: 1px solid var(--wp-border); background: var(--wp-bg-deep, var(--wp-bg)); }
.wp-tgw__cap { font: 600 9px var(--wp-font-sans, sans-serif); letter-spacing: 0.08em; color: var(--wp-text-dim, var(--wp-text3)); }
.wp-tgw__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px 14px; }
/* The window is the panel: no second box around it. */
.wp-tgw__body .wp-tgr__edit { padding: 0; border: 0; background: none; }
.wp-tgr__edit { display: flex; flex-direction: column; gap: 10px; }
.wp-tgr__field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.wp-tgr__field > span { font-size: 10.5px; font-weight: 600; color: var(--wp-text-muted, var(--wp-text2)); }
.wp-tgr__field em { font-style: normal; font-weight: 400; color: var(--wp-text-dim, var(--wp-text3)); margin-left: 4px; }
.wp-tgr__two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
.wp-tgr__edit-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.wp-tgr__check { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; cursor: pointer; }
.wp-tgr__var-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wp-tgr__var-row .wp-tgr__var { flex: 1 1 0; min-width: 80px; }
.wp-tgr__note { margin: 0; display: flex; align-items: baseline; gap: 5px; font-size: 10.5px; line-height: 1.4; color: var(--wp-amber, var(--wp-warn)); }
.wp-tgr__looks { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.wp-tgr__look { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--wp-text-muted, var(--wp-text2)); }
</style>
