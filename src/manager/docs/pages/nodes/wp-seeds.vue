<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import Banner from "@/kit/Banner.vue";
import DocFields from "../../../components/docs/DocFields.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Seeds"
    icon="pi pi-table"
    tone="node"
    node-id="WP_Seeds"
    blurb="Named seeds in one place: each Context picks the one it runs on, and each sampler can take its own, per loop frame."
  >
    <DocSection title="What it does">
      <p>
        A Context Loop gives every frame one base seed, and every Context after it follows that seed.
        WP Seeds lets you name the seeds your workflow needs (Hero, Background, Sampler …) and choose,
        per node, which one it uses. Each row is a seed of its own, with a value for every frame of
        the loop, and a lock for any frame you want to keep.
      </p>
      <DocUseWhen
        :good="[
          'Keeping the hero the same while the background changes every frame',
          'Giving two Contexts or two samplers their own seeds from one place',
          'Locking the seed one frame used, for one Context only',
        ]"
        :better="[
          'One seed per frame for a single sampler: WP Seed List does just that',
        ]"
      />
    </DocSection>

    <DocSection title="Set it up">
      <DocFlow figure="wp-seeds-flow"
        :stages="[
          { icon: 'pi pi-replay', name: 'WP Context Loop', sub: 'N frames', tone: 'node' },
          { icon: 'pi pi-table', name: 'WP Seeds', sub: 'a seed per row', tone: 'node' },
          { icon: 'pi pi-sitemap', name: 'WP Context', sub: 'Seed from › Hero', tone: 'node' },
        ]"
        :arrows="['context', 'context']"
        caption="Put WP Seeds after the Loop in the Context chain, then pick a row on each Context's Seed from chip."
      />
      <ol style="margin-top: 14px;">
        <li>Wire the Loop's context output into WP Seeds, and WP Seeds' context output into your first WP Context.</li>
        <li>Select WP Seeds and press the pencil above it. <b>Add seed</b> for each seed you need, and name it in its window.</li>
        <li>On each WP Context, click the <b>Seed from</b> chip at the top and pick the row.</li>
        <li>For a sampler, tick <b>INT output</b> in the row's window and wire the dot into the sampler's seed.</li>
      </ol>
    </DocSection>

    <DocSection title="The controls">
      <DocFields node="WP_Seeds" group="controls" />
      <Banner tone="info" note>
        A Follow row's seed comes from the node's base seed and the row's name. Renaming the row gives it a
        new seed; switch it to Fixed first (the mode button on the row) to keep the one it has.
      </Banner>
    </DocSection>

    <DocSection title="Seed from on a Context">
      <p>
        Every WP Context with a Loop or a WP Seeds node upstream shows a <b>Seed from</b> chip next to
        its name. Nothing takes over on its own: a seed wired into the Context is only used on
        <b>Own seed</b> and <b>Auto</b>, and the Loop's override only applies on <b>Auto</b> and
        <b>Loop</b>.
      </p>
      <DocFields node="WP_Context" group="ports" />
    </DocSection>

    <DocSection title="Good to know">
      <ul>
        <li>Two rows with the same name: Contexts read the first one, and the second shows a warning.</li>
        <li>Random rows roll a new seed once the prompt is queued, like a seed set to randomize. The row's Last run button brings back the one it ran with.</li>
        <li>With <b>From Loop</b> on, the Loop's seed is the base seed: one number drives the Loop and every Follow row. The Loop's override still only changes Contexts on Auto.</li>
        <li>Without a Loop every row has one seed, and its outputs give one value.</li>
        <li>Locks are per row and per frame, so one Context can keep frame 3 while the others move on.</li>
        <li>More on seeds: <DocRef id="seeds-and-loops" />.</li>
      </ul>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'seeds-and-loops', label: 'Seeds &amp; loops', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wp-context-loop', label: 'WP Context Loop', icon: 'pi pi-replay', tone: 'node' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'wp-seed-list', label: 'WP Seed List', icon: 'pi pi-clone', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
