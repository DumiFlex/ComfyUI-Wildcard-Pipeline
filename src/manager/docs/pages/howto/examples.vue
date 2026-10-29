<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="How to"
    title="Start from an example"
    icon="pi pi-th-large"
    tone="neutral"
    blurb="Three ready-made workflows that run on an empty library, with notes that walk you through each step."
  >
    <DocSection title="Open one">
      <p>
        In ComfyUI, open <b>Workflow › Browse Templates</b> and pick <b>Wildcard Pipeline</b> in the
        list of node packs. Each example is a complete workflow: choose your checkpoint in
        <b>Load Checkpoint</b> and press <b>Run</b>.
      </p>
      <ul>
        <li><b>1 - One image</b>: the core chain (two WP Contexts, the Assembler and the Cleaner)
          with WP Debug. WP Toggles is the switchboard: a LoRA switch bypasses its loader and swaps
          the trigger words from the Context Injector into the prompt, and another switches the
          group that reads the image size, sampler and CFG from the loaded model (a Mode Relay
          passes it on to a Node Group).</li>
        <li><b>2 - Batches and grids</b>: a WP Context Loop sweeps every outfit against every time of
          day, a second Assembler writes the labels and WP Label &amp; Grid lays the images out as
          an XY plot. WP Toggles in Pick one mode chooses Quick or Full: its value sets the steps
          through WP Var → Int, and WP Var → Bool picks a smaller image for Quick.</li>
        <li><b>3 - Pick and refine</b>: four drafts, a pause at WP Image Filter to pick the keepers,
          then an upscale and a second pass on the picks only.</li>
      </ul>
      <p>
        A <b>Start here</b> note lists the steps and links to these docs, the Discord and the
        Community. Notes on the canvas explain each step, with links to the docs and to outside
        guides and checkpoints. The notes that open a step are also bookmarks that frame their
        whole group: the <b>Bookmarks</b> dock lists them, and Alt+1, Alt+2… jump between them.
      </p>
    </DocSection>

    <DocSection title="The lists come with the workflow">
      <p>
        Every list, rule and bundle in an example is stored on its WP Context, so nothing has to be
        in your library. Bundle headers show a grey <strong>EXAMPLE</strong> chip instead of the red
        <strong>MISSING</strong> badge: nothing is wrong, the bundle just lives only in this workflow.
      </p>
      <p>
        To keep one, right-click its header and choose <b>Push to library…</b> with <b>Restore
        missing references</b> ticked. It saves the bundle, its sub-bundles and every row in one
        step, and the chip goes away. See <DocRef id="bundles" />.
      </p>
      <DocCallout variant="tip">
        The <b>Shared lists</b> sub-bundle is switched off on purpose. Other lists read its colours
        through <VarToken kind="ref">@{…}</VarToken> references, so it never adds words of its own.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'quick-start', label: 'Quick start', icon: 'pi pi-play', tone: 'neutral' },
          { id: 'bundles', label: 'Bundles', icon: 'pi pi-box', tone: 'bundle' },
          { id: 'howto-share', label: 'Share a pack or workflow', icon: 'pi pi-share-alt', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
