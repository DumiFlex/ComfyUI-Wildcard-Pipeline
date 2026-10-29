<script setup lang="ts">
/**
 * Display Playground modal — single-pane companion for the ComfyUI
 * Settings panel. Reachable via the launcher button at the top of
 * `Wildcard Pipeline → Display`.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │  Display Playground                       ×  │
 *   ├──────────────────────┬───────────────────────┤
 *   │   [controls]         │   [live mockup]       │
 *   │   density            │                       │
 *   │   decoration         │   <module card>       │
 *   │   module type        │                       │
 *   │   indicator style    │                       │
 *   │   border highlights  │                       │
 *   │   collapse default   │                       │
 *   │   focus mode         │                       │
 *   ├──────────────────────┴───────────────────────┤
 *   │     [Reset all]               [Done]         │
 *   └──────────────────────────────────────────────┘
 *
 * Live binding: every control change calls `applySetting(key, value)`,
 * which routes to `app.extensionManager.setting.set(...)`. ComfyUI
 * fires the registered onChange — that handler updates our state map,
 * flips body markers (so the mockup AND the underlying canvas update
 * instantly), and emits a toast. No "Apply" button needed; closing
 * the modal just dismisses it, settings persist as you go.
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  playgroundOpen,
  closePlayground,
  applySetting,
  getSettingValue,
  type SettingKey,
} from "./playground-store";
import PlaygroundMockup from "./PlaygroundMockup.vue";
import PlaygroundBehaviorPreview from "./PlaygroundBehaviorPreview.vue";
import WpCheck from "@/kit/WpCheck.vue";
import WpSelect from "@/kit/WpSelect.vue";
import WpButton from "@/kit/WpButton.vue";
import CloseButton from "@/kit/CloseButton.vue";
import { useDialogFocus } from "@/kit/useDialogFocus";
import { useHostDialogGuard } from "@/components/shared/useHostDialogGuard";

type Density = "comfortable" | "compact" | "minimal";
type Decoration = "full" | "minimal" | "off";
type IndicatorStyle = "both" | "badge" | "dot";
type KindStyle = "both" | "icon" | "chip";
type A11yMode = "auto" | "on" | "off";
type ValidationMode = "strict" | "relaxed" | "permissive";
type ToastLifetime = "short" | "default" | "long" | "sticky";
type CollapseMode = "independent" | "accordion";
type RowActions = "always" | "hover";
type ColorIntensity = "muted" | "standard" | "vivid";
type BundleMasterOffBehavior = "preserve-manual" | "cascade-all";

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

// Local refs mirror the stored setting values. We use plain refs (not
// computed) because the underlying source — extensionManager.setting.get
// — is NOT a Vue reactive value, so a computed getter wouldn't know
// when to re-evaluate. Instead, we resync from the store every time
// the modal opens (see watch(playgroundOpen) below) and write back via
// applySetting on every change. This guarantees the controls always
// reflect the latest persisted state, even after edits made via the
// native settings panel between modal opens.
const density = ref<Density>("comfortable");
const decoration = ref<Decoration>("full");
const indicatorStyle = ref<IndicatorStyle>("badge");
const kindStyle = ref<KindStyle>("chip");
const borderHighlight = ref<boolean>(true);
const collapsedByDefault = ref<boolean>(false);
const bundleCollapsedByDefault = ref<boolean>(false);
const collapseMode = ref<CollapseMode>("independent");
const colorIntensity = ref<ColorIntensity>("standard");
const focusMode = ref<boolean>(false);
const rowActions = ref<RowActions>("always");
const reduceMotion = ref<A11yMode>("auto");
const contrast = ref<A11yMode>("auto");
// Phase 2 — behavior axes
const validation = ref<ValidationMode>("strict");
const tagAutocomplete = ref<boolean>(false);
const loraAutocomplete = ref<boolean>(false);
const embeddingAutocomplete = ref<boolean>(false);
const autocompleteSeparator = ref<boolean>(false);
const autocompleteSpaces = ref<boolean>(false);
const autocompleteEscapeBrackets = ref<boolean>(false);
const autocompleteMaxSuggestions = ref<string>("20");
const autocompleteMinChars = ref<string>("3");
const toastLifetime = ref<ToastLifetime>("default");
const suppressInfoToasts = ref<boolean>(false);
const imageFilterSound = ref<boolean>(true);
const imageFilterNotify = ref<boolean>(false);
const newModuleDisabled = ref<boolean>(false);
const confirmDestructiveBundle = ref<boolean>(true);
const bundleMasterOffBehavior = ref<BundleMasterOffBehavior>("preserve-manual");

/**
 * Pull every value from the store into the local refs. Called on
 * every modal open so external changes (settings panel, OS prefs
 * change, another tab editing the same workflow) reflect immediately.
 */
function syncFromStore(): void {
  density.value = asString(getSettingValue("density"), "comfortable") as Density;
  decoration.value = asString(getSettingValue("decoration"), "full") as Decoration;
  indicatorStyle.value = asString(getSettingValue("indicatorStyle"), "badge") as IndicatorStyle;
  kindStyle.value = asString(getSettingValue("kindStyle"), "chip") as KindStyle;
  borderHighlight.value = asBool(getSettingValue("borderHighlight"), true);
  collapsedByDefault.value = asBool(getSettingValue("collapsedByDefault"), false);
  bundleCollapsedByDefault.value = asBool(getSettingValue("bundleCollapsedByDefault"), false);
  collapseMode.value = asString(getSettingValue("collapseMode"), "independent") as CollapseMode;
  colorIntensity.value = asString(getSettingValue("colorIntensity"), "standard") as ColorIntensity;
  focusMode.value = asBool(getSettingValue("focusMode"), false);
  rowActions.value = asString(getSettingValue("rowActions"), "always") as RowActions;
  reduceMotion.value = asString(getSettingValue("reduceMotion"), "auto") as A11yMode;
  contrast.value = asString(getSettingValue("contrast"), "auto") as A11yMode;
  validation.value = asString(getSettingValue("validation"), "strict") as ValidationMode;
  tagAutocomplete.value = getSettingValue("tagAutocomplete") === true;
  loraAutocomplete.value = getSettingValue("loraAutocomplete") === true;
  embeddingAutocomplete.value = getSettingValue("embeddingAutocomplete") === true;
  autocompleteSeparator.value = getSettingValue("autocompleteSeparator") === true;
  autocompleteSpaces.value = getSettingValue("autocompleteSpaces") === true;
  autocompleteEscapeBrackets.value = getSettingValue("autocompleteEscapeBrackets") === true;
  autocompleteMaxSuggestions.value = asString(getSettingValue("autocompleteMaxSuggestions"), "20");
  autocompleteMinChars.value = asString(getSettingValue("autocompleteMinChars"), "3");
  toastLifetime.value = asString(getSettingValue("toastLifetime"), "default") as ToastLifetime;
  suppressInfoToasts.value = asBool(getSettingValue("suppressInfoToasts"), false);
  imageFilterSound.value = asBool(getSettingValue("imageFilterSound"), true);
  imageFilterNotify.value = asBool(getSettingValue("imageFilterNotify"), false);
  newModuleDisabled.value = asBool(getSettingValue("newModuleDisabled"), false);
  confirmDestructiveBundle.value = asBool(getSettingValue("confirmDestructiveBundle"), true);
  bundleMasterOffBehavior.value = asString(
    getSettingValue("bundleMasterOffBehavior"),
    "preserve-manual",
  ) as BundleMasterOffBehavior;
}

// Per-ref watchers persist to extensionManager whenever a control
// flips. The onChange handler in buildSettings() short-circuits when
// `next === state.X` so syncFromStore's redundant writes (every open)
// are no-ops — no toast, no body class re-flip. Means we don't need
// a suppression flag; the change-detection lives one layer down where
// it already had to live for ComfyUI's load-fire suppression.
watch(density, (v) => applySetting("density", v));
watch(decoration, (v) => applySetting("decoration", v));
watch(indicatorStyle, (v) => applySetting("indicatorStyle", v));
watch(kindStyle, (v) => applySetting("kindStyle", v));
watch(borderHighlight, (v) => applySetting("borderHighlight", v));
watch(collapsedByDefault, (v) => applySetting("collapsedByDefault", v));
watch(bundleCollapsedByDefault, (v) => applySetting("bundleCollapsedByDefault", v));
watch(collapseMode, (v) => applySetting("collapseMode", v));
watch(colorIntensity, (v) => applySetting("colorIntensity", v));
watch(focusMode, (v) => applySetting("focusMode", v));
watch(rowActions, (v) => applySetting("rowActions", v));
watch(reduceMotion, (v) => applySetting("reduceMotion", v));
watch(contrast, (v) => applySetting("contrast", v));
watch(validation, (v) => applySetting("validation", v));
watch(tagAutocomplete, (v) => applySetting("tagAutocomplete", v));
watch(loraAutocomplete, (v) => applySetting("loraAutocomplete", v));
watch(embeddingAutocomplete, (v) => applySetting("embeddingAutocomplete", v));
watch(autocompleteSeparator, (v) => applySetting("autocompleteSeparator", v));
watch(autocompleteSpaces, (v) => applySetting("autocompleteSpaces", v));
watch(autocompleteEscapeBrackets, (v) => applySetting("autocompleteEscapeBrackets", v));
watch(autocompleteMaxSuggestions, (v) => applySetting("autocompleteMaxSuggestions", v));
watch(autocompleteMinChars, (v) => applySetting("autocompleteMinChars", v));
watch(toastLifetime, (v) => applySetting("toastLifetime", v));
watch(suppressInfoToasts, (v) => applySetting("suppressInfoToasts", v));
watch(imageFilterSound, (v) => applySetting("imageFilterSound", v));
watch(imageFilterNotify, (v) => applySetting("imageFilterNotify", v));
watch(newModuleDisabled, (v) => applySetting("newModuleDisabled", v));
watch(confirmDestructiveBundle, (v) => applySetting("confirmDestructiveBundle", v));
watch(bundleMasterOffBehavior, (v) => applySetting("bundleMasterOffBehavior", v));

interface Defaults {
  density: Density;
  decoration: Decoration;
  indicatorStyle: IndicatorStyle;
  kindStyle: KindStyle;
  borderHighlight: boolean;
  collapsedByDefault: boolean;
  bundleCollapsedByDefault: boolean;
  collapseMode: CollapseMode;
  colorIntensity: ColorIntensity;
  focusMode: boolean;
  rowActions: RowActions;
  reduceMotion: A11yMode;
  contrast: A11yMode;
  validation: ValidationMode;
  tagAutocomplete: boolean;
  loraAutocomplete: boolean;
  embeddingAutocomplete: boolean;
  autocompleteSeparator: boolean;
  autocompleteSpaces: boolean;
  autocompleteEscapeBrackets: boolean;
  autocompleteMaxSuggestions: string;
  autocompleteMinChars: string;
  toastLifetime: ToastLifetime;
  suppressInfoToasts: boolean;
  imageFilterSound: boolean;
  imageFilterNotify: boolean;
  newModuleDisabled: boolean;
  confirmDestructiveBundle: boolean;
  bundleMasterOffBehavior: BundleMasterOffBehavior;
}

const defaults: Defaults = {
  density: "comfortable",
  decoration: "full",
  indicatorStyle: "badge",
  kindStyle: "chip",
  borderHighlight: true,
  collapsedByDefault: false,
  bundleCollapsedByDefault: false,
  collapseMode: "independent",
  colorIntensity: "standard",
  focusMode: false,
  rowActions: "always",
  reduceMotion: "auto",
  contrast: "auto",
  validation: "strict",
  tagAutocomplete: false,
  loraAutocomplete: false,
  embeddingAutocomplete: false,
  autocompleteSeparator: false,
  autocompleteSpaces: false,
  autocompleteEscapeBrackets: false,
  autocompleteMaxSuggestions: "20",
  autocompleteMinChars: "3",
  toastLifetime: "default",
  suppressInfoToasts: false,
  imageFilterSound: true,
  imageFilterNotify: false,
  newModuleDisabled: false,
  confirmDestructiveBundle: true,
  bundleMasterOffBehavior: "preserve-manual",
};

function onResetAll(): void {
  for (const [key, value] of Object.entries(defaults) as [SettingKey, unknown][]) {
    applySetting(key, value);
  }
  // Resync local refs immediately so the controls reflect the reset
  // without waiting for the next reopen.
  syncFromStore();
}

function onClose(): void {
  closePlayground();
}

// The playground opens from ComfyUI's Settings dialog, which stays open
// underneath. useDialogFocus moves focus in, keeps Tab inside and closes on
// Escape; the host guard stops the Settings dialog from swallowing clicks,
// pulling focus back or closing along with us.
const overlayEl = ref<HTMLElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
useDialogFocus(panelEl, () => playgroundOpen.value, { onEscape: closePlayground });
useHostDialogGuard(overlayEl, () => playgroundOpen.value);

function onOpenChange(open: boolean): void {
  if (open) {
    // Resync local refs from the store on every open so external
    // changes (settings panel edits between modal opens, OS pref
    // changes, debug-helper writes) reflect immediately. Without
    // this, refs hold whatever they were when the modal last
    // closed and the user sees stale values.
    syncFromStore();
    // Lock body scroll while the modal is open — same pattern as
    // ModalShell uses for ModuleEditModal / ModulePickerModal.
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = "";
  }
}

watch(playgroundOpen, onOpenChange);

// `main.ts` mounts this the first time the launcher opens it, so the ref is
// usually already true here and the watcher above never saw the change.
onMounted(() => {
  if (playgroundOpen.value) onOpenChange(true);
});

onBeforeUnmount(() => {
  document.body.style.overflow = "";
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="playgroundOpen"
      ref="overlayEl"
      class="wp-pg-overlay"
      data-test="playground-overlay"
      @click.self="onClose"
    >
      <section
        ref="panelEl"
        class="wp-pg"
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-labelledby="wp-pg-title"
      >
        <header class="wp-pg__head">
          <div class="wp-pg__head-inner">
            <i class="pi pi-palette wp-pg__head-icon" aria-hidden="true" />
            <div>
              <h3 id="wp-pg-title" class="wp-pg__title">Display Playground</h3>
              <p class="wp-pg__subtitle">
                Tweak Wildcard Pipeline visuals — changes apply live.
              </p>
            </div>
          </div>
          <CloseButton label="Close playground" size="sm" kbd="Esc" @click="onClose" />
        </header>

        <div class="wp-pg__body">
          <section class="wp-pg__controls" data-test="playground-controls">
            <fieldset class="wp-pg__group">
              <legend class="wp-pg__group-title">Sizing</legend>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Module density</span>
                <WpSelect
                  v-model="density" class="wp-pg__select"
                  :options="[{ value: 'comfortable', label: 'Comfortable (default)' }, { value: 'compact', label: 'Compact' }, { value: 'minimal', label: 'Minimal' }]"
                />
              </label>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Decoration</span>
                <WpSelect
                  v-model="decoration" class="wp-pg__select"
                  :options="[{ value: 'full', label: 'Full (default)' }, { value: 'minimal', label: 'Minimal' }, { value: 'off', label: 'Off (flat)' }]"
                />
              </label>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Color intensity</span>
                <WpSelect
                  v-model="colorIntensity" class="wp-pg__select"
                  :options="[{ value: 'muted', label: 'Muted (low saturation)' }, { value: 'standard', label: 'Standard (default)' }, { value: 'vivid', label: 'Vivid (high saturation)' }]"
                />
              </label>
            </fieldset>

            <fieldset class="wp-pg__group">
              <legend class="wp-pg__group-title">Module identity</legend>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Module type style</span>
                <WpSelect
                  v-model="kindStyle" class="wp-pg__select"
                  :options="[{ value: 'chip', label: 'Chip (default)' }, { value: 'icon', label: 'Icon (compact)' }, { value: 'both', label: 'Both (verbose)' }]"
                />
              </label>
            </fieldset>

            <fieldset class="wp-pg__group">
              <legend class="wp-pg__group-title">State markers</legend>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Indicator style</span>
                <WpSelect
                  v-model="indicatorStyle" class="wp-pg__select"
                  :options="[{ value: 'badge', label: 'Badge (default)' }, { value: 'dot', label: 'Dot (compact)' }, { value: 'both', label: 'Both (verbose)' }]"
                />
              </label>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Border highlights</span>
                <WpCheck v-model="borderHighlight" aria-label="Border highlights" />
              </div>
            </fieldset>

            <fieldset class="wp-pg__group">
              <legend class="wp-pg__group-title">Collapse &amp; focus</legend>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Collapse new modules by default</span>
                <WpCheck v-model="collapsedByDefault" aria-label="Collapse new modules by default" />
              </div>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Collapse new bundles by default</span>
                <WpCheck v-model="bundleCollapsedByDefault" aria-label="Collapse new bundles by default" />
              </div>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Collapse stack mode</span>
                <WpSelect
                  v-model="collapseMode" class="wp-pg__select"
                  :options="[{ value: 'independent', label: 'Independent (default)' }, { value: 'accordion', label: 'Accordion (one at a time)' }]"
                />
              </label>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Focus mode (dim non-hovered)</span>
                <WpCheck v-model="focusMode" aria-label="Focus mode (dim non-hovered)" />
              </div>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Row buttons</span>
                <WpSelect
                  v-model="rowActions" class="wp-pg__select"
                  :options="[{ value: 'always', label: 'Always (default)' }, { value: 'hover', label: 'On hover' }]"
                />
              </label>
            </fieldset>

            <fieldset class="wp-pg__group">
              <legend class="wp-pg__group-title">Accessibility</legend>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Reduce motion</span>
                <WpSelect
                  v-model="reduceMotion" class="wp-pg__select"
                  :options="[{ value: 'auto', label: 'Match system' }, { value: 'on', label: 'Always reduce' }, { value: 'off', label: 'Always allow' }]"
                />
              </label>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Contrast</span>
                <WpSelect
                  v-model="contrast" class="wp-pg__select"
                  :options="[{ value: 'auto', label: 'Match system' }, { value: 'on', label: 'High contrast' }, { value: 'off', label: 'Standard' }]"
                />
              </label>
            </fieldset>

            <fieldset class="wp-pg__group">
              <legend class="wp-pg__group-title">Runtime behavior</legend>
              <!-- Previewed under the module mockup on the right
                   (PlaygroundBehaviorPreview): toasts, autocomplete and
                   validation. -->
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Booru tag autocomplete</span>
                <WpCheck v-model="tagAutocomplete" aria-label="Booru tag autocomplete" />
              </div>
              <!-- Separate switches on purpose: someone writing danbooru
                   prompts may have no LoRAs at all, and someone with 200 of
                   them may find the tag list noise. -->
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">LoRA autocomplete</span>
                <WpCheck v-model="loraAutocomplete" aria-label="LoRA autocomplete" />
              </div>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Embedding autocomplete</span>
                <WpCheck v-model="embeddingAutocomplete" aria-label="Embedding autocomplete" />
              </div>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Append ", " after a completion</span>
                <WpCheck v-model="autocompleteSeparator" aria-label="Append a comma and space after a completion" />
              </div>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Write tags with spaces</span>
                <WpCheck v-model="autocompleteSpaces" aria-label="Write tags with spaces" />
              </div>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Escape brackets in tags</span>
                <WpCheck v-model="autocompleteEscapeBrackets" aria-label="Escape brackets in tags" />
              </div>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Autocomplete: max suggestions</span>
                <WpSelect
                  v-model="autocompleteMaxSuggestions" class="wp-pg__select"
                  :options="[{ value: '5', label: '5' }, { value: '10', label: '10' }, { value: '20', label: '20 (default)' }, { value: '40', label: '40' }]"
                />
              </label>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Autocomplete: minimum characters</span>
                <WpSelect
                  v-model="autocompleteMinChars" class="wp-pg__select"
                  :options="[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3 (default)' }, { value: '4', label: '4' }]"
                />
              </label>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Validation strictness</span>
                <WpSelect
                  v-model="validation" class="wp-pg__select"
                  :options="[{ value: 'strict', label: 'Strict (default)' }, { value: 'relaxed', label: 'Relaxed (hide info)' }, { value: 'permissive', label: 'Permissive (off)' }]"
                />
              </label>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Toast lifetime</span>
                <WpSelect
                  v-model="toastLifetime" class="wp-pg__select"
                  :options="[{ value: 'short', label: 'Short (3 s)' }, { value: 'default', label: 'Default (5 s)' }, { value: 'long', label: 'Long (10 s)' }, { value: 'sticky', label: 'Sticky' }]"
                />
              </label>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Suppress info toasts</span>
                <WpCheck v-model="suppressInfoToasts" aria-label="Suppress info toasts" />
              </div>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Image Filter sound</span>
                <WpCheck v-model="imageFilterSound" aria-label="Image Filter sound" />
              </div>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Image Filter desktop notification</span>
                <WpCheck v-model="imageFilterNotify" aria-label="Image Filter desktop notification" />
              </div>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">New modules start disabled</span>
                <WpCheck v-model="newModuleDisabled" aria-label="New modules start disabled" />
              </div>
              <div class="wp-pg__row wp-pg__row--switch">
                <span class="wp-pg__row-label">Confirm destructive bundle actions</span>
                <WpCheck v-model="confirmDestructiveBundle" aria-label="Confirm destructive bundle actions" />
              </div>
              <label class="wp-pg__row">
                <span class="wp-pg__row-label">Bundle master OFF behavior</span>
                <WpSelect
                  v-model="bundleMasterOffBehavior" class="wp-pg__select"
                  :options="[{ value: 'preserve-manual', label: 'Preserve manual (default)' }, { value: 'cascade-all', label: 'Cascade — clear everyone' }]"
                />
              </label>
            </fieldset>
          </section>

          <aside class="wp-pg__preview" data-test="playground-preview">
            <PlaygroundMockup />
            <PlaygroundBehaviorPreview
              :validation="validation"
              :max-suggestions="autocompleteMaxSuggestions"
              :min-chars="autocompleteMinChars"
              :separator="autocompleteSeparator"
              :spaces="autocompleteSpaces"
              :escape="autocompleteEscapeBrackets"
            />
          </aside>
        </div>

        <footer class="wp-pg__foot">
          <WpButton size="md" @click="onResetAll">Reset all to defaults</WpButton>
          <WpButton variant="primary" size="md" @click="onClose">Done</WpButton>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style>
/* @layer wp-extension — keeps these rules below host CSS in cascade
 * priority, so even if a host page happened to style any of the
 * .wp-pg-* selectors, the host wins. Layered author rules are
 * subservient to unlayered ones in the same origin. */
@layer wp-extension {
.wp-pg-overlay {
  position: fixed;
  inset: 0;
  background: var(--wp-overlay-bg, rgba(0, 0, 0, 0.55));
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  font-family: var(--wp-font-sans);
}
.wp-pg {
  background: var(--wp-bg);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  box-shadow: var(--wp-shadow-lg, 0 12px 40px rgba(0, 0, 0, 0.5));
  width: min(960px, 100%);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  color: var(--wp-text);
  outline: none;
}
.wp-pg__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--wp-border);
  background: var(--wp-brand-gradient);
  position: relative;
}
/* Scrim that knocks the brand gradient back so the title stays readable on
 * top of it. It was hardcoded to a near-black rgba, so under the light theme
 * the banner stayed dark while `--wp-text` flipped to a DARK ink — dark text
 * on a dark band. The scrim now follows the theme: near-black under dark,
 * near-white under light, each keeping the same 0.85 knock-back. */
.wp-pg__head::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--wp-pg-head-scrim, rgba(35, 35, 35, 0.85));
  pointer-events: none;
}
.wp-theme-light .wp-pg__head {
  --wp-pg-head-scrim: rgba(248, 248, 250, 0.85);
}
.wp-theme-dark .wp-pg__head {
  --wp-pg-head-scrim: rgba(35, 35, 35, 0.85);
}
.wp-pg__head > * { position: relative; z-index: 1; }
.wp-pg__head-inner { display: flex; gap: 10px; align-items: flex-start; }
.wp-pg__head-icon {
  font-size: 14px;
  color: var(--wp-violet);
  margin-top: 2px;
}
.wp-pg__title {
  margin: 0;
  font: 600 13px/1.2 var(--wp-font-sans);
  color: var(--wp-text);
}
.wp-pg__subtitle {
  margin: 4px 0 0;
  font: 11px/1.3 var(--wp-font-sans);
  color: var(--wp-text-muted, var(--wp-text2));
}
.wp-pg__body {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(300px, 1.2fr);
  gap: 16px;
  padding: 16px;
  overflow: auto;
  flex: 1;
}
.wp-pg__controls {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.wp-pg__group {
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-sm);
  padding: 10px 12px 12px;
  margin: 0;
}
.wp-pg__group-title {
  font: 600 10px/1 var(--wp-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--wp-text-muted, var(--wp-text2));
  padding: 0 4px;
}
.wp-pg__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 0;
  font-size: 12px;
  color: var(--wp-text);
}
.wp-pg__row + .wp-pg__row {
  border-top: 1px dashed var(--wp-border);
}
.wp-pg__row-label {
  flex: 1;
  min-width: 0;
}
.wp-pg__select { min-width: 160px; height: 26px; font-size: 12px; }
.wp-pg__preview {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.wp-pg__foot {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid var(--wp-border);
  background: var(--wp-bg2);
}
/* Narrow viewport — stack panes */
@media (max-width: 720px) {
  .wp-pg__body {
    grid-template-columns: 1fr;
  }
}
}  /* end @layer wp-extension */
</style>
