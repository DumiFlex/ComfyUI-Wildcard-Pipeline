<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const controls = [
  { term: "base_seed", desc: "Where the seed list starts. Same base, same seeds." },
  { term: "count", desc: "How many seeds it gives (1–999). Follows the loop's count while Override count from loop is on." },
  { term: "Strategy", desc: "hash, sequential (base, base+1 …) or stride. It changes which numbers you get, not how varied the images are." },
  { term: "Per-iteration seeds", desc: "Lock single seeds, Lock all, Copy / Paste, or Prev to keep the seed a frame used last run." },
  { term: "Override … from loop", desc: "Three switches: take the base seed, the count and the strategy from the wired loop. Count and strategy switch on by themselves when you connect loop_config; base seed stays yours unless you switch it on." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Seed List"
    icon="pi pi-clone"
    tone="node"
    node-id="WP_SeedList"
    blurb="Gives a sampler one seed per loop frame, so every frame of a WP Context Loop makes its own image."
  >
    <DocSection title="What it does">
      <p>
        A plain KSampler takes one seed and uses it for every frame of a loop. Two frames that roll
        the same prompt then make the same image. WP Seed List gives the sampler a list of seeds
        instead, one per frame: frame 1 gets seed 1, frame 2 gets seed 2, and so on.
      </p>
      <DocUseWhen
        :good="[
          'Giving each loop frame its own sampler seed',
          'Keeping an image you liked reproducible (lock its seed)',
        ]"
        :better="[
          'Prompt variety: it never changes a prompt. The Context seed and the Loop do that',
        ]"
      />
    </DocSection>

    <DocSection title="Set it up">
      <DocFlow figure="wp-seed-list-flow"
        :stages="[
          { icon: 'pi pi-replay', name: 'WP Context Loop', sub: 'N prompts', tone: 'node' },
          { icon: 'pi pi-clone', name: 'WP Seed List', sub: 'N seeds', tone: 'node' },
          { icon: 'pi pi-image', name: 'KSampler', sub: 'N different images', tone: 'neutral' },
        ]"
        :arrows="['loop_config', 'paired in order']"
        caption="Wire the loop's loop_config into the Seed List and its seed output into the sampler's seed."
      />
      <ol style="margin-top: 14px;">
        <li>Wire the loop's <code>loop_config</code> output into the Seed List.</li>
        <li>Wire the Seed List's <code>seed</code> output into your sampler's seed input (right-click
          the sampler and convert seed to an input if needed).</li>
      </ol>
      <p>The count now follows the loop, so the two lists always line up.</p>
      <DocImage
        src="images/docs/wp-seed-list.png"
        ratio="16 / 7"
        caption="WP Context Loop's loop_config wired into WP Seed List, whose seed output drives the KSampler's seed."
      />
    </DocSection>

    <DocSection title="The controls">
      <DocKeyList :items="controls" />
      <DocCallout variant="tip">
        Prev is the one to use after a run you liked: the list shows the seeds for the next run,
        and Prev locks the seed the frame actually used.
      </DocCallout>
    </DocSection>

    <DocSection title="Good to know">
      <ul>
        <li>Without a loop it still gives <b>count</b> seeds, so the sampler runs that many times.
          Set count to 1 for a single seed.</li>
        <li>Unplugging <code>loop_config</code> leaves the switches as they were; the node falls
          back to its own values.</li>
        <li>Seeds stay in the range ComfyUI's own randomize button uses, so you can copy one into a
          plain sampler and get the same image.</li>
        <li>More on seeds: <DocRef id="seeds-and-loops" />.</li>
      </ul>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'seeds-and-loops', label: 'Seeds &amp; loops', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wp-context-loop', label: 'WP Context Loop', icon: 'pi pi-replay', tone: 'node' },
          { id: 'iteration-overrides', label: 'Per-iteration overrides', icon: 'pi pi-images', tone: 'neutral' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
