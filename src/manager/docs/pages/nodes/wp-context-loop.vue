<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const controls = [
  { term: "Count", desc: "How many variations to make in one run (1–999). Set it to 1 to switch looping off without removing the node." },
  { term: "Seed", desc: "The starting point for the batch. Change it for a different set of variations; keep it the same to reproduce the same batch. Right-click → Convert widget to input to drive it from another seed node." },
  { term: "Override seed", desc: "On: the loop chooses the seed for every iteration, so the whole batch is reproducible from this one seed. Off (default): each WP Context keeps using its own seed and the loop just nudges it per iteration." },
  { term: "Variation strategy", desc: "How the per-iteration seeds spread out. Hashed (default) makes each iteration unrelated and maximally varied; Sequential walks seed, seed+1, seed+2… so neighbours feel related; Prime stride takes large even jumps." },
  { term: "Bypass", desc: "The node's own on/off switch. When on, the loop collapses to a single run but stays wired, so you can flip it back without rebuilding the graph." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Context Loop"
    icon="pi pi-replay"
    tone="node"
    node-id="WP_ContextLoop"
    blurb="Generate several variations in one click. Place it before your WP Context and a single Generate runs the whole workflow N times automatically."
  >
    <DocSection title="What it's for">
      <p>
        Normally one Generate makes one image. Put a <b>WP Context Loop</b> in front of your
        WP Context and one Generate makes several images instead — each with a fresh roll of your
        wildcards. Set the count to 8, press Generate once, and compare eight variations. No
        repeated queueing, no batch node to wire.
      </p>
      <DocImage
        ratio="16 / 6"
        caption="The WP Context Loop node wired in front of a WP Context → WP Prompt Assembler → KSampler chain, with its count set to 4. Show the node and its widget clearly."
      />
    </DocSection>

    <DocSection title="The controls">
      <DocKeyList :items="controls" />
    </DocSection>

    <DocSection title="Iteration variables">
      <p>
        Each run, the loop hands you two variables to drop into your prompt template or any combine:
      </p>
      <ul>
        <li>
          <VarToken>$iteration</VarToken> — which run you're on, starting at 1 (1, 2, 3 … up to the
          count). Handy for labelling outputs.
        </li>
        <li>
          <VarToken>$iteration_total</VarToken> — the total number of runs. Same on every iteration.
        </li>
      </ul>
      <p>
        For example, a template of
        <VarToken>frame $iteration of $iteration_total — $subject</VarToken> renders
        “frame 1 of 4 — a fox”, “frame 2 of 4 — a cat”, and so on. These two variables stay out of
        the rendered prompt by default — switch their <b>internal</b> flag off in the loop config
        if you want them to appear in the text.
      </p>
      <DocImage
        ratio="16 / 7"
        caption="A 2×2 grid of four generated images, each captioned “frame 1 of 4” … “frame 4 of 4”, showing $iteration count up while the rest of the prompt stays constant."
      />
    </DocSection>

    <DocSection title="Good to know">
      <DocCallout variant="tip">
        A module with a <b>locked seed</b> ignores the loop — it makes the same pick every
        iteration. Useful for holding one thing steady (say, the art style) while everything else
        varies across the batch.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'seeds-and-loops', label: 'Seeds &amp; loops', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
