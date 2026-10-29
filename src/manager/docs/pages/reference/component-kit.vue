<script setup lang="ts">
import { useRouter } from "vue-router";
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import Button from "../../../../kit/Button.vue";
import { KIT_ENTRIES } from "../../../kit/registry";
import { KIT_SITE } from "../../../config/links";

const router = useRouter();
const appPieces = KIT_ENTRIES.length;
</script>

<template>
  <DocPage
    group="Reference"
    title="Component kit"
    icon="pi pi-th-large"
    tone="neutral"
    blurb="Every shared control, colour and size the extension is built from, shown live."
  >
    <p>
      The extension and the community site are built from one component kit, <b>wp-kit</b>. Its site shows
      each piece working, what it is for, what it replaces and the few lines that use it. A switcher at the
      top shows them in any palette and look, light or dark.
    </p>
    <p class="wp-doc-kit__actions">
      <a class="wp-btn wp-btn--primary wp-btn--md" :href="KIT_SITE" target="_blank" rel="noopener" data-test="doc-open-kit-site">
        <i class="pi pi-external-link" aria-hidden="true" /> Open the kit site
      </a>
      <Button variant="secondary" icon="pi pi-th-large" data-test="doc-open-kit" @click="router.push({ name: 'kit' })">
        App pieces
      </Button>
    </p>

    <DocSection title="What's in it">
      <ul>
        <li><b>Tokens</b>: the colours, type sizes, spacing and corners, with the value each has in the palette you pick.</li>
        <li><b>Controls</b>: buttons, fields, dropdowns, checkboxes and switches, tabs, sliders, tag, date, colour and icon pickers.</li>
        <li><b>Display and layout</b>: cards, chips, badges, tables, lists, code blocks, diffs, image grids and split panels.</li>
        <li><b>Feedback and overlays</b>: toasts, banners, progress, popovers, menus, tooltips, dialogs and drawers.</li>
      </ul>
      <p>
        Each of these is one component on both sides: the search box in a node picker and on a manager page is
        the same box, and so are the number fields, tabs and toasts. The <b>App pieces</b> page here shows the
        {{ appPieces }} parts only the extension has, because they work with your library: the prompt box, the
        negative box, the selection bar and a few more.
      </p>
    </DocSection>

    <DocSection title="Reuse first">
      <p>
        New screens are built from kit pieces. A new control is made only when nothing in the kit fits, and it
        goes into wp-kit with its demo on the site; the extension then brings in the new kit version. Two checks
        keep this honest: one fails when a piece has no demo, the other fails when a file adds a hand-made
        button, select, number box, dialog or colour.
      </p>
      <p>
        Every control follows one standard: the same prop names (size, variant, tone), one height scale,
        colour tokens only, full keyboard use, Escape to close anything that floats, and focus back where
        it was. The full rules are in <code>docs/component-standard.md</code> in the repository.
      </p>
      <DocCallout variant="tip">
        <b>Settings › About</b> says which kit version this copy of the extension uses, and
        <b>Settings › Advanced › Component kit</b> opens the kit site or the app pieces.
      </DocCallout>
    </DocSection>
  </DocPage>
</template>

<style scoped>
.wp-doc-kit__actions { display: flex; flex-wrap: wrap; gap: var(--wp-space-4); }
</style>
