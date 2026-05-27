<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
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
        <b>WP Context</b> and one Generate makes <b>N</b> images instead — each with a fresh roll
        of your wildcards. Perfect for exploring a prompt: set the count to 8, press Generate once,
        and compare eight variations. No repeated queueing, no batch node to wire.
      </p>
      <DocImage
        ratio="16 / 6"
        caption="The WP Context Loop node wired in front of a WP Context → WP Prompt Assembler → KSampler chain, with its count set to 4. Show the node and its widget clearly."
      />
    </DocSection>

    <DocSection title="The controls">
      <ul>
        <li>
          <b>Count</b> — how many variations to make in one run (1–999). Set it to 1 to switch
          looping off without removing the node.
        </li>
        <li>
          <b>Seed</b> — the starting point for the batch. Change it for a different set of
          variations; keep it the same to reproduce the same batch. Right-click →
          <em>Convert widget to input</em> to drive it from another seed node.
        </li>
        <li>
          <b>Override seed</b> — when <b>on</b>, the loop chooses the seed for every iteration, so
          the entire batch is reproducible from this one seed. When <b>off</b> (the default), each
          WP Context keeps using its own seed and the loop just nudges it per iteration. Turn it on
          when you want “the same 8 results every time from this seed.”
        </li>
        <li>
          <b>Variation strategy</b> — how the per-iteration seeds are spread out.
          <b>Hashed</b> (default) makes each iteration unrelated and maximally varied;
          <b>Sequential</b> walks seed, seed+1, seed+2 … so neighbouring results feel related;
          <b>Prime stride</b> takes large even jumps. Leave it on Hashed unless you want a
          particular feel.
        </li>
        <li>
          <b>Bypass</b> — the node's own on/off switch. When on, the loop is skipped (a single
          run) but stays wired, so you can flip it back without rebuilding the graph.
        </li>
      </ul>
      <DocImage
        ratio="4 / 3"
        caption="Close-up of the loop config widget with each control labelled: the count field, the Override seed toggle, the Variation strategy dropdown, and the Bypass switch."
      />
    </DocSection>

    <DocSection title="Iteration variables">
      <p>
        Inside every iteration the loop gives you two variables you can drop into your prompt
        template (in the Assembler) or any combine:
      </p>
      <ul>
        <li>
          <VarToken>$iteration</VarToken> — which run you're on, starting at <b>1</b>
          (1, 2, 3 … up to the count). Handy for labelling outputs.
        </li>
        <li>
          <VarToken>$iteration_total</VarToken> — the total number of runs. It's the same on
          every iteration.
        </li>
      </ul>
      <p>
        For example, a template of
        <VarToken>frame $iteration of $iteration_total — $subject</VarToken> renders
        “frame 1 of 4 — a fox”, “frame 2 of 4 — a cat”, and so on. By default these variables are
        hidden from the final prompt; switch their <b>internal</b> flag off in the loop config if
        you want them to show up in the rendered text.
      </p>
      <DocImage
        ratio="16 / 7"
        caption="A 2×2 grid of four generated images, each captioned “frame 1 of 4” … “frame 4 of 4”, showing $iteration count up while the rest of the prompt stays constant."
      />
    </DocSection>

    <DocSection title="Good to know">
      <DocCallout variant="warn">
        ComfyUI's built-in bypass shortcut (<b>Ctrl-B</b>) does not work on this node — use the
        node's own <b>Bypass</b> switch instead. Mute (Ctrl-M) works normally.
      </DocCallout>
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
