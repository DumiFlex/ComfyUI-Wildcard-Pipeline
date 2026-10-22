<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const ways = [
  { term: "Keep one pick for good: Lock pick", desc: "Click the lock on a row (Lock seed on modules other than wildcards). It keeps its result on every Generate until you unlock it. Good for a style you've settled on." },
  { term: "Keep one pick for a batch: Hold across run", desc: "Right-click a row, or switch it on in the row's editor. Every loop frame of one Generate shares the pick; the next Generate picks again. Good for one character through a story." },
  { term: "Always the same option: untick the others", desc: "In the row's editor, untick every option but one. Or use a Fixed Values module if it never changes at all." },
  { term: "Keep every pick: fix the Context seed", desc: "Set the WP Context's seed to fixed (control after generate). The same seed and the same modules give the same prompt every time." },
  { term: "Keep the image too: fix the sampler seed", desc: "The prompt and the sampler have separate seeds. For the same image, fix both. With a loop, lock the seeds in WP Seed List." },
  { term: "Keep one frame: lock it on that frame", desc: "With a loop, pick the frame's chip and lock the row there. Only that frame keeps its pick." },
];
</script>

<template>
  <DocPage
    group="How to"
    title="Keep something the same"
    icon="pi pi-lock"
    tone="neutral"
    blurb="Keep a style, a character or a whole prompt while the rest keeps changing."
  >
    <DocSection title="Choose how long it should stay">
      <DocKeyList :items="ways" />
      <DocCallout variant="tip">
        Found a prompt you like? In WP Debug, note the Context's seed and put it back in the seed
        box later, or lock the rows that matter. The Test Runner's <b>Copy seed</b> does the same
        for a seed you found there.
      </DocCallout>
    </DocSection>

    <DocSection title="Good to know">
      <ul>
        <li>A lock keeps the module's dice the same. If you edit its options, or a constraint above
          it changes the odds, the result can still change. Hold across run keeps the finished
          text instead.</li>
        <li>Hide from prompt and Hold across run apply to every frame, so they're greyed out while
          you edit a single frame.</li>
        <li>The full story of seeds is on <DocRef id="seeds-and-loops" />.</li>
      </ul>
    </DocSection>

    <DocSection title="Related">
      <CrossLinks
        :links="[
          { id: 'seeds-and-loops', label: 'Seeds &amp; loops', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wp-seed-list', label: 'WP Seed List', icon: 'pi pi-clone', tone: 'node' },
          { id: 'iteration-overrides', label: 'Per-iteration overrides', icon: 'pi pi-images', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
