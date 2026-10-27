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
        A few pieces only work on the canvas (the node dialog, the right-click menu and the canvas toast).
        The kit lists them with how to use them instead of a live demo.
      </p>
    </DocSection>

    <DocSection title="Reuse first">
      <p>
        New screens are built from kit entries. A new control is made only when nothing in the kit fits,
        and it goes into the kit in the same change, with a demo. Two checks keep this honest: one fails
        when a shared control has no kit entry, the other fails when a file adds a hand-made button, select,
        number box, dialog or colour.
      </p>
      <DocCallout variant="tip">
        You can also open the kit from <b>Settings › Advanced › Component kit</b>.
      </DocCallout>
    </DocSection>
  </DocPage>
</template>
