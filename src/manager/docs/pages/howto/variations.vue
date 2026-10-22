<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="How to"
    title="Make variations in one click"
    icon="pi pi-images"
    tone="neutral"
    blurb="Get several different prompts and images from one Generate, or every combination of a few options."
  >
    <DocSection title="Several random variations">
      <ol>
        <li>Add a <b>WP Context Loop</b> and wire its <code>context</code> output into your first
          WP Context's <code>upstream</code> input.</li>
        <li>Set <b>count</b> to how many variations you want, say 4.</li>
        <li>Add a <b>WP Seed List</b>: wire the loop's <code>loop_config</code> into it and its
          <code>seed</code> output into your sampler's seed.</li>
        <li>Press Generate once. You get four prompts and four images.</li>
      </ol>
      <DocImage
        src="images/docs/wp-context-loop-graph.png"
        ratio="16 / 7"
        caption="WP Context Loop (count 4) → WP Context → WP Prompt Assembler using $iteration of $iteration_total → one prompt per frame."
      />
      <DocCallout variant="warn">
        Skip the Seed List and the sampler uses the same seed for every frame, so two frames with
        the same prompt give the same image.
      </DocCallout>
    </DocSection>

    <DocSection title="Every combination of a few options">
      <p>
        To compare options side by side, open <b>Sweep combinations</b> on the loop, switch it on
        and add the wildcards to sweep. Three hair colours against two moods make six frames, one
        per pair. Keep the sampler on one fixed seed so only the prompt changes. More on
        <DocRef id="wp-context-loop" />.
      </p>
    </DocSection>

    <DocSection title="Keep one thing the same across the batch">
      <p>
        Switch on <b>Hold across run</b> on a row, such as the character, and every frame keeps
        that pick while the rest changes. The next Generate picks a new one. See
        <DocRef id="howto-keep-steady" />.
      </p>
    </DocSection>

    <DocSection title="Number the frames">
      <p>
        <VarToken>$iteration</VarToken> is the frame number and
        <VarToken>$iteration_total</VarToken> the count. They're hidden from the prompt until you
        click their globe and Σ buttons on the loop. A derivation can also test
        <VarToken>$iteration</VarToken> to tell a story over the frames.
      </p>
    </DocSection>

    <DocSection title="Related">
      <CrossLinks
        :links="[
          { id: 'wp-context-loop', label: 'WP Context Loop', icon: 'pi pi-replay', tone: 'node' },
          { id: 'wp-seed-list', label: 'WP Seed List', icon: 'pi pi-clone', tone: 'node' },
          { id: 'iteration-overrides', label: 'Per-iteration overrides', icon: 'pi pi-images', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
