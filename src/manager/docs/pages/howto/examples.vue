<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import Banner from "@/kit/Banner.vue";
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
    blurb="Four ready-made workflows that run on an empty library, with notes that walk you through each step."
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
        <li><b>2 - Batches and grids</b>: a WP Context Loop sweeps three shots against three
          lights on one held person, a second Assembler writes the labels and WP Label &amp; Grid lays the images out as
          an XY plot. WP Toggles in Pick one mode chooses Quick or Full: its value sets the steps
          through WP Var → Int, and WP Var → Bool picks a smaller image for Quick.</li>
        <li><b>3 - Pick and refine</b>: four drafts of one held person, a pause at WP Image Filter
          to pick the keepers (the contact sheet names each pick's look), then an upscale and a
          second pass on the picks only.</li>
        <li><b>4 - Sets and stories</b>: one loop, three ways, each in its own canvas group. WP
          Toggles in Pick one mode mutes the groups you didn't pick. <i>Every frame different</i>
          rolls everything again each frame; <i>Photo shoot</i> holds the person, outfit, place and
          light and gives each frame its own shot; <i>Storyboard</i> holds a story and writes each
          frame's beat with a derivation on <VarToken>$story</VarToken> and
          <VarToken>$iteration</VarToken>. Each group pauses at WP Image Filter so you pick the
          frames that go on the Label &amp; Grid sheet.</li>
      </ul>
      <p>
        Each workflow reads left to right, one canvas group per step, and long wires (the model,
        the CLIP, the settings) run straight along a lane under the groups on wire reroutes. In
        <i>Sets and stories</i> each mode's row has four parts, <b>Lists</b>, <b>Prompt</b>,
        <b>Image</b> and <b>Pick and grid</b>, and one checkpoint on the left feeds all three rows.
      </p>
      <p>
        A <b>Start here</b> note lists the steps and links to these docs, the Discord and the
        Community. Notes on the canvas explain each step, with links to the docs and to outside
        guides and checkpoints. The notes that open a step are also bookmarks that frame their
        whole group: the <b>Bookmarks</b> dock lists them (Start here too), and the number keys 1, 2…
        jump between them while the canvas has focus. The Start here note also points at the indigo
        <b>?</b> in the toolbar over a selected node, which opens that node's help page.
      </p>
    </DocSection>

    <DocSection title="The packs">
      <p>
        All four share one family of packs, each a bundle with sub-bundles. They describe people in plain words and name no style, so they suit anime, illustration and photo models alike:
        <b>Person</b> (gender, age, heritage, build, skin, hair, eyes, makeup or facial hair),
        <b>Location</b> (place and time of day), <b>Wardrobe</b> (an outfit that fits the place,
        with shoes it accepts), <b>Light</b>, <b>Camera</b> (shot, angle, focus, colour palette) and
        <b>Direction</b> (pose and expression). Constraints keep them coherent: the place picks
        the time and the light, the shot picks the focus and leaves out poses it can't see.
      </p>
      <p>
        <b>Render</b> reads <VarToken>$model_variant</VarToken> and
        <VarToken>$model_family</VarToken> from WP Model Info and writes only the quality
        words and their negative for the loaded model: Illustrious / NoobAI quality tags by
        default, Pony's score tags, or nothing for Flux and other sentence models. Your style
        (anime, photo, painting) goes in the template.
      </p>
    </DocSection>

    <DocSection title="The lists come with the workflow">
      <p>
        Every list, rule and bundle in an example is stored on its WP Context, so nothing has to be
        in your library. Bundle headers show a grey <strong>EXAMPLE</strong> chip instead of the red
        <strong>MISSING</strong> badge: nothing is wrong, the bundle just lives only in this workflow.
      </p>
      <p>
        To keep them all, press <b>Add this workflow's lists to my library</b> on the
        <b>Start here</b> note: a review lists every bundle and module, and one press of Add saves them
        (Undo on the message takes them back out). See <DocRef id="wp-note" />.
      </p>
      <p>
        To keep just one, right-click its header and choose <b>Push to library…</b> with <b>Restore
        missing references</b> ticked. It saves the bundle, its sub-bundles and every row in one
        step, and the chip goes away. See <DocRef id="bundles" />.
      </p>
      <Banner tone="info" note>
        The <b>Shared lists</b> sub-bundle is switched off on purpose. Other lists read its colours
        through <VarToken kind="ref">@{…}</VarToken> references, so it never adds words of its own.
      </Banner>
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
