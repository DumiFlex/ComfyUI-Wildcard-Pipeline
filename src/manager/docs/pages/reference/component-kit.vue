<script setup lang="ts">
import { useRouter } from "vue-router";
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import Button from "../../../components/ui/Button.vue";
import { KIT_ENTRIES, KIT_GROUPS } from "../../../kit/registry";

const router = useRouter();
const groups = KIT_GROUPS.map((g) => ({ ...g, count: KIT_ENTRIES.filter((e) => e.group === g.id).length }));
</script>

<template>
  <DocPage
    group="Reference"
    title="Component kit"
    icon="pi pi-th-large"
    tone="neutral"
    blurb="Every shared control, colour and size the extension is built from, shown live in one page."
  >
    <p>
      The kit page shows each shared control working, what it is for, what it replaces and the few lines
      that use it. It follows your theme and accent colour, so you see the controls as they look for you.
    </p>
    <p>
      <Button variant="primary" icon="pi pi-th-large" data-test="doc-open-kit" @click="router.push({ name: 'kit' })">
        Open the kit
      </Button>
    </p>

    <DocSection title="What's in it">
      <ul>
        <li><b>Tokens</b>: the colours, type sizes, spacing and corners, with the value each has right now.</li>
        <li v-for="g in groups" :key="g.id"><b>{{ g.label }}</b> ({{ g.count }}): {{ g.blurb }}</li>
      </ul>
      <p>
        Pieces shared by the canvas and the manager (the node dialog, the right-click menu, popovers,
        tooltips, the search box, the number field and the toast) are shown live too. Each of these is
        one component on both sides: the search box in a node picker and on a manager page is the same
        box, and so are the number fields and toasts. The canvas toast store is the one piece listed
        with how to use it instead of a live demo.
      </p>
    </DocSection>

    <DocSection title="Reuse first">
      <p>
        New screens are built from kit entries. A new control is made only when nothing in the kit fits,
        and it goes into the kit in the same change, with a demo. Two checks keep this honest: one fails
        when a shared control has no kit entry, the other fails when a file adds a hand-made button, select,
        number box, dialog or colour.
      </p>
      <p>
        Every control follows one standard: the same prop names (size, variant, tone), one height scale,
        colour tokens only, full keyboard use, Escape to close anything that floats, and focus back where
        it was. Anything that floats (a panel, a menu, a hint, a side panel) uses the kit's overlays.
        The full rules are in <code>docs/component-standard.md</code> in the repository.
      </p>
      <DocCallout variant="tip">
        You can also open the kit from <b>Settings › Advanced › Component kit</b>.
      </DocCallout>
    </DocSection>
  </DocPage>
</template>
