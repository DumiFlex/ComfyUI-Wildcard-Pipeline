<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import picksDiagram from "../../images/how-picks-carry-over.webp";

const ports = [
  { term: "images", desc: "The images to pick from. Required: this is what the picker shows." },
  { term: "latent, masks", desc: "Sliced to the picked images. A mask you paint in the picker replaces that image's mask." },
  { term: "positive, negative", desc: "CONDITIONING. A batched conditioning is sliced with the images; a single one is kept for every frame that keeps an image." },
  { term: "positive_text, negative_text", desc: "The prompt strings, kept or dropped with their frame." },
  { term: "context", desc: "Each frame's WP Context, kept or dropped with it." },
  { term: "clip (in)", desc: "Optional. Re-encodes a prompt you edit in the picker, so the positive/negative conditioning follows the edit. Without it, an edit changes only the text outputs." },
  { term: "extra_1, extra_2", desc: "Any type. The output takes the type of what you connect. Batched values are sliced, anything else follows its frame." },
  { term: "picks (out)", desc: "What was kept, as frame:image (1-based), for example 1:2, 3:1." },
];

const keys = [
  { term: "Click", desc: "Pick or unpick an image. A frame's all button picks the whole frame; Ctrl+A picks everything." },
  { term: "Frame", desc: "Click the frame around an image (its border or label) to zoom in, where you can compare, edit the prompt and paint a mask. The Zoom & refine button in the header does the same." },
  { term: "Space", desc: "Zoom the image under the mouse, or leave the zoom (same as Zoom & refine). In the zoom, ←/→ move and ↑ picks. The picker remembers: leave it zoomed and the next one opens zoomed." },
  { term: "I", desc: "In the zoom: Details. Lists the frame's variable values (Copy copies them) and seed, shows the frame's other images with Pick whole frame, and marks each value in the positive prompt (click it to edit). Remembered for next time." },
  { term: "C", desc: "In the zoom: pin this image, then step to another to compare the two with a slider. C again stops." },
  { term: "M", desc: "In the zoom: paint a mask on this image (brush, eraser, size, invert, clear)." },
  { term: "Enter", desc: "Keep the picks and let the run go on." },
  { term: "Escape", desc: "Tuck the picker away. A waiting pill at the bottom of the screen opens it again, picks intact." },
];

const settings = [
  { term: "Mode", desc: "Pause & pick asks every run. Reuse last picks keeps the same picks without asking, and asks again when they no longer fit. Pass all lets everything through." },
  { term: "Send picks as", desc: "Same shape keeps each frame's picks together as one batch. One per image sends every pick as its own item, with its own copy of its frame's prompt, conditioning and Context." },
  { term: "Timeout", desc: "Seconds to wait; 0 waits until you answer. After a timeout it keeps all, keeps the first image, or stops the branch." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Image Filter"
    icon="pi pi-filter"
    tone="node"
    node-id="WP_ImageFilter"
    blurb="Pause the run, pick the images worth keeping, and send only those on, with their own prompts and conditioning."
  >
    <DocSection title="What it's for">
      <p>
        Upscaling every image of a batch costs time on the ones you'd throw away. Put
        <b>WP Image Filter</b> between the first KSampler and the upscaler: the run stops there,
        a picker shows every image, and only the ones you pick continue. Everything that belongs
        to an image travels with it, so the upscaler gets each picked image's own latent,
        conditioning and prompt.
      </p>
    </DocSection>

    <DocSection title="Where it goes">
      <DocFlow
        :stages="[
          { icon: 'pi pi-images', name: 'KSampler + VAE Decode', sub: 'images, latent', tone: 'neutral' },
          { icon: 'pi pi-filter', name: 'WP Image Filter', sub: 'you pick', tone: 'node' },
          { icon: 'pi pi-arrow-up-right', name: 'Upscaler', sub: 'picked only', tone: 'neutral' },
        ]"
        :arrows="['images + prompts', 'picks']"
        caption="Wire the same conditioning and prompt text through the filter that the upscaler would otherwise take from the start."
      />
      <DocCallout variant="tip">
        With a <b>Context Loop</b>, every iteration is a frame. The picker groups images by frame,
        and the prompt, conditioning and Context of a frame are kept only when one of its images is.
      </DocCallout>
    </DocSection>

    <DocSection title="Inputs &amp; outputs">
      <p>Every input has a matching output. Connect only what you need.</p>
      <DocKeyList :items="ports" />
    </DocSection>

    <DocSection title="The picker">
      <DocKeyList :items="keys" />
      <p>
        <b>Keep all</b> sends everything on. <b>Stop branch</b> stops the nodes after this one;
        the rest of the run finishes normally. Cancelling the run closes the picker.
      </p>
      <DocCallout variant="tip">
        A short chime plays when the picker opens, and the tab title starts with
        <b>● Pick images</b> while something waits, so you notice from another tab. Turn the chime
        off with <b>Image Filter sound</b> in Settings; turn on <b>Image Filter desktop
        notification</b> to also get a system notification while the tab is in the background.
      </DocCallout>
    </DocSection>

    <DocSection title="Labels, sweep grid and Send to Loop">
      <p>
        With a <b>Context Loop</b>, each frame is labelled with its number and the options its
        sweep pinned (for example <code>#3 · red · pencil</code>). Hover a label to see the
        frame's seed and prompt. A sweep of two or more wildcards opens as a <b>grid</b>. The bar above it picks
        which wildcard goes on <b>Rows</b> and which on <b>Columns</b> (⇄ swaps them); any others
        <b>Split by</b>, one small grid per value. Click a row, column or group name to pick all of
        it. <b>Frames</b> in the header switches back to the list.
      </p>
      <p>
        <b>Send to Loop</b> writes your picks back to the loop: the picked frames' seeds are
        locked (when the loop overrides seeds) and every other frame is bypassed, so the next run
        repeats only what you kept.
      </p>
    </DocSection>

    <DocSection title="Refine before it goes on">
      <p>
        In the zoom, the <b>Refine</b> panel edits the frame's positive and negative prompt and
        paints a mask for the upscaler. Edits travel with the picks; tiles show ✎ for an edited
        prompt and ◐ for a painted mask.
      </p>
      <ul>
        <li>An edited prompt replaces the text output. Wire a <b>CLIP</b> into the filter's
          <code>clip</code> input and the conditioning is re-encoded to match; without one the
          conditioning stays as it was, and the panel says so.</li>
        <li>With <b>Same shape</b> a frame's picks go on together, so a prompt edit covers the
          whole frame. With <b>One per image</b> it covers just that image.</li>
        <li>A painted mask goes to the <code>masks</code> output, resized to the image. Images you
          don't paint keep the incoming mask, or an empty one when nothing is wired in.</li>
      </ul>
      <figure class="wp-doc-figure">
        <img :src="picksDiagram" alt="How the picks carry over: images, latents, masks, conditioning and prompt text of picked frames go on; an edited prompt is re-encoded and a painted mask goes to the masks output." loading="lazy">
      </figure>
    </DocSection>

    <DocSection title="Settings on the node">
      <DocKeyList :items="settings" />
      <p>The <b>Last run</b> strip under the settings shows what the last run kept.</p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-context-loop', label: 'WP Context Loop', icon: 'pi pi-replay', tone: 'node' },
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
          { id: 'wp-seed-list', label: 'WP Seed List', icon: 'pi pi-clone', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>

<style scoped>
.wp-doc-figure { margin: 12px 0 0; }
.wp-doc-figure img { display: block; max-width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--wp-border, #34343a); }
</style>
