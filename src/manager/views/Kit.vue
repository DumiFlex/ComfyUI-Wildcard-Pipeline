<script setup lang="ts">
/**
 * The component kit (`/kit`, linked from Settings › Advanced): every shared
 * control, live, with when to use it and how to write it. Entries and their
 * text live in `kit/registry.ts`; `kit-coverage.test.ts` checks that every
 * entry has a demo here and every kit-folder component has an entry.
 *
 * Canvas-only pieces (ModalShell, ContextMenu, the canvas toast) are not
 * mounted here: their stylesheet sets the canvas colours on :root and would
 * repaint the whole manager. Their entries show how to use them instead.
 */
import { computed, ref } from "vue";
import Button from "../components/ui/Button.vue";
import Card from "../components/ui/Card.vue";
import Checkbox from "../components/ui/Checkbox.vue";
import Chip from "../components/ui/Chip.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import Field from "../components/ui/Field.vue";
import Icon, { ICON_LG, ICON_MD, ICON_SM } from "../components/ui/Icon.vue";
import Input from "../components/ui/Input.vue";
import ListFilter from "../components/ui/ListFilter.vue";
import Modal from "../components/ui/Modal.vue";
import Select from "../components/ui/Select.vue";
import Textarea from "../components/ui/Textarea.vue";
import Toggle from "../components/ui/Toggle.vue";
import type { SelectOption } from "../components/ui/select-types";
import Breadcrumb from "../components/Breadcrumb.vue";
import CategoryChip from "../components/CategoryChip.vue";
import DraftBanner from "../components/DraftBanner.vue";
import IconPicker from "../components/IconPicker.vue";
import NegativeField from "../components/NegativeField.vue";
import RelativeDate from "../components/RelativeDate.vue";
import RichTextInput from "../components/RichTextInput.vue";
import SelectionToolbar from "../components/SelectionToolbar.vue";
import ValidityIcon from "../components/ValidityIcon.vue";
import ColorPicker from "../components/ColorPicker.vue";
import { allCuratedIcons } from "../components/icon-catalog";
import ConfirmDialog from "@/components/shared/ConfirmDialog.vue";
import HsvPicker from "@/components/shared/HsvPicker.vue";
import LoadingMark from "@/components/shared/LoadingMark.vue";
import Logo from "@/components/shared/Logo.vue";
import WpCheck from "@/components/shared/WpCheck.vue";
import WpNumber from "@/components/shared/WpNumber.vue";
import WpSelect from "@/components/shared/WpSelect.vue";
import { useToast } from "../composables/useToast";
import KitEntry from "../kit/KitEntry.vue";
import KitTokens from "../kit/KitTokens.vue";
import { KIT_ENTRIES, KIT_GROUPS } from "../kit/registry";

const toast = useToast();

const groups = computed(() =>
  KIT_GROUPS.map((g) => ({ ...g, entries: KIT_ENTRIES.filter((e) => e.group === g.id) })),
);

// Demo state. Sample content is the starter library's, so it reads like the app.
const name = ref("Hair colour");
const variable = ref("hair");
const notes = ref("Warm colours for portraits.");
const category = ref<string | number | null>("characters");
const categories: SelectOption[] = [
  { value: "characters", label: "Characters", dot: "#60a5fa" },
  { value: "scenes", label: "Scenes", dot: "#34d399" },
  { value: "style", label: "Style", dot: "#f472b6" },
];
const strategy = ref<"hash" | "sequential" | "stride">("hash");
const strategies = [
  { value: "hash" as const, label: "Hash" },
  { value: "sequential" as const, label: "Sequential" },
  { value: "stride" as const, label: "Stride" },
];
const count = ref<number | null>(4);
const query = ref("");
const rules = ["when $mood is dramatic", "when $mood is calm", "when $weather is rain", "when $time is night", "otherwise"];
const shownRules = computed(() => rules.filter((r) => r.includes(query.value.toLowerCase())));
const colour = ref("#60a5fa");
const hsv = ref("#6366f1");
const picked = ref(true);
const unpicked = ref(false);
const hold = ref(true);
const tooltips = ref(true);
const mode = ref("tags");
const tab = ref("options");
const TABS = [
  { id: "options", label: "Options" },
  { id: "rules", label: "Rules" },
  { id: "preview", label: "Preview" },
];
const modalOpen = ref(false);
const confirmOpen = ref(false);
const icons = allCuratedIcons();
const template = ref("$mood portrait of $subject, {soft|warm} light, <lora:film_grain:0.6>, #portrait");
const negative = ref("blurry, cropped");
const pickedIcon = ref<string | null>("user");
const draftShown = ref(true);
const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
const yesterday = new Date(Date.now() - 26 * 3600_000).toISOString();

function pushToast(kind: "success" | "warn"): void {
  if (kind === "success") {
    toast.push({ severity: "success", summary: "Saved Hair colour", action: { label: "Undo", run: () => undefined } });
  } else {
    toast.push({ severity: "warn", summary: "Mood fits weather", detail: "Its source wildcard is missing." });
  }
}
</script>

<template>
  <div class="wp-page wp-kit" data-test="kit-page">
    <div class="wp-page__header">
      <div class="wp-page__title-wrap">
        <h1 class="wp-page__title">Component kit</h1>
        <p class="wp-page__subtitle">
          Every shared control, in the current theme. Building a screen? Use what is here. When nothing fits,
          make the new component in a kit folder and add it to this page.
        </p>
      </div>
    </div>

    <div class="wp-kit__layout">
      <nav class="wp-kit__nav" aria-label="Kit sections">
        <a href="#kit-tokens" class="wp-kit__nav-link">Tokens</a>
        <template v-for="g in groups" :key="g.id">
          <a :href="`#kit-group-${g.id}`" class="wp-kit__nav-link">{{ g.label }}</a>
          <a v-for="e in g.entries" :key="e.id" :href="`#kit-${e.id}`" class="wp-kit__nav-link wp-kit__nav-link--sub">{{ e.name }}</a>
        </template>
      </nav>

      <div class="wp-kit__main">
        <section class="wp-kit__group">
          <h2 class="wp-kit__group-title">Tokens</h2>
          <p class="wp-kit__group-blurb">Colours, type and spacing. Use a token, never a raw colour or size.</p>
          <KitTokens />
        </section>

        <section v-for="g in groups" :id="`kit-group-${g.id}`" :key="g.id" class="wp-kit__group" :data-kit-group="g.id">
          <h2 class="wp-kit__group-title">{{ g.label }}</h2>
          <p class="wp-kit__group-blurb">{{ g.blurb }}</p>

          <template v-for="e in g.entries" :key="e.id">
            <KitEntry :id="e.id">
              <template v-if="e.id === 'button'">
                <Button variant="primary" icon="pi-plus">New module</Button>
                <Button>Cancel</Button>
                <Button variant="outline" icon="pi-book">Docs</Button>
                <Button variant="ghost" icon="pi-refresh">Refresh</Button>
                <Button variant="danger" icon="pi-trash">Delete</Button>
                <Button variant="link">Open in library</Button>
                <Button variant="ghost" icon="pi-cog" aria-label="Settings" />
                <Button size="sm">Small</Button>
                <Button size="lg" variant="primary">Large</Button>
                <Button loading>Saving</Button>
                <Button disabled>Disabled</Button>
              </template>

              <template v-else-if="e.id === 'btn-css'">
                <button type="button" class="wp-btn wp-btn--primary wp-btn--sm">Run</button>
                <button type="button" class="wp-btn wp-btn--sm">Base</button>
                <button type="button" class="wp-btn wp-btn--ghost wp-btn--sm">Clear</button>
              </template>

              <template v-else-if="e.id === 'input'">
                <div class="wp-kit__stack">
                  <Input v-model="name" aria-label="Name" />
                  <Input v-model="variable" addon="$" aria-label="Variable name" />
                  <Input model-value="" icon="pi-search" placeholder="Search modules" aria-label="Search modules" />
                  <Input model-value="Hair colour" error aria-label="Name with an error" />
                  <Input model-value="Locked" disabled aria-label="Disabled field" />
                </div>
              </template>

              <template v-else-if="e.id === 'textarea'">
                <div class="wp-kit__stack">
                  <Textarea v-model="notes" :rows="3" aria-label="Notes" />
                </div>
              </template>

              <template v-else-if="e.id === 'field'">
                <div class="wp-kit__stack">
                  <Field label="Name" hint="Shown in the library and on the node." for="kit-field-name">
                    <Input id="kit-field-name" v-model="name" />
                  </Field>
                  <Field label="Writes" error="$subject isn't set by anything upstream." for="kit-field-var">
                    <Input id="kit-field-var" model-value="subject" addon="$" error />
                  </Field>
                </div>
              </template>

              <template v-else-if="e.id === 'select'">
                <div class="wp-kit__stack">
                  <Select v-model="category" :options="categories" clearable aria-label="Category" />
                </div>
              </template>

              <template v-else-if="e.id === 'wp-select'">
                <WpSelect v-model="strategy" :options="strategies" aria-label="Strategy" class="wp-kit__compact" />
              </template>

              <template v-else-if="e.id === 'wp-number'">
                <WpNumber v-model="count" :min="1" :max="64" aria-label="Count" class="wp-kit__compact" />
              </template>

              <template v-else-if="e.id === 'list-filter'">
                <div class="wp-kit__stack">
                  <ListFilter v-model="query" :total="rules.length" :visible="shownRules.length" noun="rules" test-prefix="kit-filter" :min-rows="0" />
                  <ul class="wp-kit__list">
                    <li v-for="r in shownRules" :key="r">{{ r }}</li>
                  </ul>
                </div>
              </template>

              <template v-else-if="e.id === 'color-picker'">
                <ColorPicker v-model="colour" aria-label="Category colour" />
              </template>

              <template v-else-if="e.id === 'hsv-picker'">
                <div class="wp-kit__hsv"><HsvPicker v-model="hsv" aria-label="Colour" /></div>
              </template>

              <template v-else-if="e.id === 'checkbox'">
                <Checkbox v-model="picked" label="Include in bundle" />
                <Checkbox v-model="unpicked" label="Hide from prompt" />
                <Checkbox :model-value="false" indeterminate label="Some selected" />
                <Checkbox :model-value="true" disabled label="Disabled" />
              </template>

              <template v-else-if="e.id === 'wp-check'">
                <span class="wp-kit__inline"><WpCheck v-model="hold" aria-label="Hold across the run" /> Hold across the run</span>
              </template>

              <template v-else-if="e.id === 'toggle'">
                <Toggle v-model="tooltips" label="Show tooltips" />
                <Toggle :model-value="false" disabled label="Disabled" />
              </template>

              <template v-else-if="e.id === 'radio'">
                <div role="radiogroup" aria-label="Writing style" class="wp-kit__row">
                  <label class="wp-kit__inline"><input v-model="mode" type="radio" class="wp-radio" value="tags"> Tags</label>
                  <label class="wp-kit__inline"><input v-model="mode" type="radio" class="wp-radio" value="phrases"> Natural phrases</label>
                  <label class="wp-kit__inline"><input v-model="mode" type="radio" class="wp-radio" value="both"> Per model family</label>
                </div>
              </template>

              <template v-else-if="e.id === 'tabs'">
                <div class="wp-kit__stack">
                  <div class="wp-tabs" role="tablist" aria-label="Editor sections">
                    <button
                      v-for="t in TABS"
                      :key="t.id"
                      type="button"
                      class="wp-tab"
                      role="tab"
                      :aria-selected="tab === t.id"
                      :data-active="tab === t.id"
                      @click="tab = t.id"
                    >{{ t.label }}</button>
                  </div>
                </div>
              </template>

              <template v-else-if="e.id === 'card'">
                <div class="wp-kit__stack">
                  <Card title="Options" subtitle="5 options">
                    <p class="wp-kit__muted">The card's body. Editors stack these.</p>
                  </Card>
                </div>
              </template>

              <template v-else-if="e.id === 'chip'">
                <Chip>portrait</Chip>
                <Chip tone="accent">$mood</Chip>
                <Chip tone="success" icon="pi-check">Rules held</Chip>
                <Chip tone="warn" icon="pi-exclamation-triangle">2 conflicts</Chip>
                <Chip tone="danger">missing $subject</Chip>
                <Chip tone="info">v10</Chip>
                <Chip removable>winter</Chip>
                <Chip color="var(--wp-kind-combine)">Combine</Chip>
              </template>

              <template v-else-if="e.id === 'category-chip'">
                <CategoryChip name="Characters" color="#60a5fa" icon="user" />
                <CategoryChip name="Scenes" color="#34d399" />
              </template>

              <template v-else-if="e.id === 'kbd'">
                <span class="wp-kit__inline"><kbd class="wp-kbd">Ctrl</kbd> <kbd class="wp-kbd">K</kbd> opens search</span>
              </template>

              <template v-else-if="e.id === 'icon'">
                <div class="wp-kit__stack">
                  <div class="wp-kit__row">
                    <Icon name="pi-bolt" :size="ICON_SM" /><span class="wp-kit__muted">ICON_SM</span>
                    <Icon name="pi-bolt" :size="ICON_MD" /><span class="wp-kit__muted">ICON_MD</span>
                    <Icon name="pi-bolt" :size="ICON_LG" /><span class="wp-kit__muted">ICON_LG</span>
                  </div>
                  <ul class="wp-kit__icons" aria-label="Category icons">
                    <li v-for="i in icons" :key="i"><Icon :name="i" :size="ICON_LG" /><span>{{ i }}</span></li>
                  </ul>
                </div>
              </template>

              <template v-else-if="e.id === 'empty-state'">
                <div class="wp-kit__stack">
                  <EmptyState icon="pi-box" headline="No bundles yet" body="A bundle drops a group of modules onto a Context node in one go.">
                    <template #cta><Button variant="primary" icon="pi-plus">New bundle</Button></template>
                  </EmptyState>
                </div>
              </template>

              <template v-else-if="e.id === 'toast'">
                <Button @click="pushToast('success')">Show a saved note</Button>
                <Button @click="pushToast('warn')">Show a warning</Button>
              </template>

              <template v-else-if="e.id === 'loading-mark'">
                <LoadingMark :size="16" label="Loading" />
                <LoadingMark :size="20">Loading bundle…</LoadingMark>
                <div class="wp-kit__stack"><LoadingMark block>Loading the library…</LoadingMark></div>
              </template>

              <template v-else-if="e.id === 'modal'">
                <Button @click="modalOpen = true">Open a dialog</Button>
                <Modal v-model:open="modalOpen" title="Rename Hair colour" size="sm">
                  <Field label="Name" for="kit-modal-name"><Input id="kit-modal-name" v-model="name" /></Field>
                  <template #footer>
                    <Button @click="modalOpen = false">Cancel</Button>
                    <Button variant="primary" @click="modalOpen = false">Rename</Button>
                  </template>
                </Modal>
              </template>

              <template v-else-if="e.id === 'confirm-dialog'">
                <Button variant="danger" icon="pi-trash" @click="confirmOpen = true">Delete Hair colour</Button>
                <ConfirmDialog
                  :visible="confirmOpen"
                  title="Delete Hair colour?"
                  body="Nodes that use it lose it. You can undo this from the toast."
                  confirm-label="Delete"
                  variant="danger"
                  @confirm="confirmOpen = false"
                  @cancel="confirmOpen = false"
                />
              </template>

              <template v-else-if="e.id === 'rich-text'">
                <div class="wp-kit__stack wp-kit__stack--wide">
                  <RichTextInput
                    v-model="template"
                    surface="assembler"
                    multiline
                    :rows="2"
                    :var-suggestions="['mood', 'subject', 'hair']"
                    aria-label="Template"
                  />
                </div>
              </template>

              <template v-else-if="e.id === 'negative-field'">
                <div class="wp-kit__stack wp-kit__stack--wide">
                  <NegativeField v-model="negative" label="option" always-open />
                </div>
              </template>

              <template v-else-if="e.id === 'breadcrumb'">
                <Breadcrumb :items="[{ to: '/wildcards', label: 'Wildcards' }, { label: 'Hair colour' }]" />
              </template>

              <template v-else-if="e.id === 'draft-banner'">
                <div class="wp-kit__stack wp-kit__stack--wide">
                  <DraftBanner :has-draft="draftShown" :age-ms="12 * 60_000" @restore="draftShown = false" @discard="draftShown = false" />
                  <Button v-if="!draftShown" size="sm" @click="draftShown = true">Show it again</Button>
                </div>
              </template>

              <template v-else-if="e.id === 'selection-toolbar'">
                <div class="wp-kit__stack wp-kit__stack--wide">
                  <SelectionToolbar :count="3" :tags="['winter', 'summer', 'formal']" :common-tags="['winter']" reorderable negatives />
                </div>
              </template>

              <template v-else-if="e.id === 'validity-icon'">
                <span class="wp-kit__inline"><ValidityIcon :issues="[]" /> No problems</span>
                <span class="wp-kit__inline"><ValidityIcon :issues="[{ severity: 'warn', message: 'Uses $subject, which nothing sets.' }]" /> A warning</span>
                <span class="wp-kit__inline"><ValidityIcon :issues="[{ severity: 'error', message: 'Points at a wildcard that is gone.' }]" /> An error</span>
              </template>

              <template v-else-if="e.id === 'relative-date'">
                <span class="wp-kit__inline">Edited <RelativeDate :value="fiveMinAgo" /></span>
                <span class="wp-kit__inline">Edited <RelativeDate :value="yesterday" /></span>
              </template>

              <template v-else-if="e.id === 'icon-picker'">
                <IconPicker v-model="pickedIcon" aria-label="Category icon" />
              </template>

              <template v-else-if="e.id === 'logo'">
                <Logo :size="16" /><Logo :size="20" /><Logo :size="28" /><Logo :size="40" />
              </template>

              <template v-else>
                <p class="wp-kit__muted" data-test="kit-canvas-only">
                  Canvas only. Its stylesheet sets the canvas colours, so it is not shown here; open a WP node to see it.
                </p>
              </template>
            </KitEntry>
          </template>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wp-kit__layout {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: var(--wp-space-7);
  align-items: start;
}
.wp-content[data-lt~="900"] .wp-kit__layout { grid-template-columns: minmax(0, 1fr); }
.wp-content[data-lt~="900"] .wp-kit__nav { display: none; }
.wp-kit__nav {
  position: sticky;
  top: var(--wp-space-6);
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
}
.wp-kit__nav-link {
  padding: 4px 8px;
  border-radius: var(--wp-radius-sm);
  color: var(--wp-text);
  font-size: var(--wp-text-sm);
  font-weight: 600;
  text-decoration: none;
}
.wp-kit__nav-link--sub { font-weight: 400; color: var(--wp-text-muted); padding-left: 16px; }
.wp-kit__nav-link:hover { background: var(--wp-bg-3); color: var(--wp-text); }
.wp-kit__main { display: flex; flex-direction: column; gap: var(--wp-space-8); min-width: 0; }
.wp-kit__group { display: flex; flex-direction: column; gap: var(--wp-space-5); scroll-margin-top: 80px; }
.wp-kit__group-title { margin: 0; font-size: var(--wp-text-lg); font-weight: 600; color: var(--wp-text); }
.wp-kit__group-blurb { margin: calc(-1 * var(--wp-space-3)) 0 0; color: var(--wp-text-muted); font-size: var(--wp-text-sm); }
.wp-kit__stack { display: flex; flex-direction: column; gap: var(--wp-space-4); width: 100%; max-width: 420px; }
.wp-kit__stack--wide { max-width: 720px; }
.wp-kit__row { display: flex; align-items: center; gap: var(--wp-space-4); flex-wrap: wrap; }
.wp-kit__inline { display: inline-flex; align-items: center; gap: var(--wp-space-3); color: var(--wp-text); font-size: var(--wp-text-base); }
.wp-kit__muted { margin: 0; color: var(--wp-text-muted); font-size: var(--wp-text-sm); }
.wp-kit__compact { width: 160px; height: 28px; }
.wp-kit__hsv { width: 240px; }
.wp-kit__list { margin: 0; padding-left: 18px; color: var(--wp-text-muted); font-size: var(--wp-text-sm); }
.wp-kit__icons {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: var(--wp-space-3);
}
.wp-kit__icons li {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: var(--wp-space-3); color: var(--wp-text); font-size: var(--wp-text-xs);
}
.wp-kit__icons span { color: var(--wp-text-dim); font-family: var(--wp-font-mono); }
</style>
