<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import DocFigureText from "../../../components/docs/DocFigureText.vue";
import DocImage from "../../../components/docs/DocImage.vue";
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

const modes = [
  { term: "Grid (G)", desc: "Pick fast. Click an image or press Space over it; Ctrl+A picks everything and a frame's all button picks the frame. Tile size S, M, L or Fit (F, as big as the picker allows). Double-click an image or click its frame to open it in Detail." },
  { term: "Detail (D)", desc: "One image next to its size, seed, values, prompt, negative and mask. Only what is wired shows. Pick / Picked (P) picks it, ←/→ step, the strip under it jumps to any image. C compares two images with a slider, M paints a mask." },
  { term: "Zoom (Z)", desc: "Only the picture, at Fit, 100%, 200% or any level between (− / +, keys 0 1 2). Scroll zooms toward the mouse, drag moves, double-click goes to 100% at that spot. F (or the fullscreen button) fills the screen. ←/→ keep the zoom and the spot on the next image." },
];

const keys = [
  { term: "Enter", desc: "Keep the picks and let the run go on." },
  { term: "Escape", desc: "Step back a mode: Zoom to Detail, Detail to Grid. From Grid it tucks the picker away; a waiting pill at the bottom of the screen opens it again, picks intact." },
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
      <DocUseWhen
        :good="[
          'A human pick before an expensive second pass (hires, upscale, detailer, video)',
          'Curating a sweep grid',
          'Inpainting a picked image in the same run',
        ]"
        :better="[
          'Unattended runs: the queue waits while the picker is open. Set it to pass all, or give it a timeout',
        ]"
      />
    </DocSection>

    <DocSection title="Where it goes">
      <DocFlow figure="wp-image-filter-flow"
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
      <p>
        The picker has three modes, switched at the top or with <b>G</b>, <b>D</b> and <b>Z</b>.
        The window keeps its size in every mode, the pick count and the Keep buttons stay in the
        footer, and the picker opens in the mode you left it in.
      </p>
      <DocImage
        src="images/docs/wp-image-filter-picker.png"
        ratio="1720 / 860"
        caption="Grid: six loop frames of two images each, at tile size M. Three images are picked."
      />
      <DocKeyList :items="modes" />
      <DocImage
        src="images/docs/wp-image-filter-zoom.png"
        ratio="1720 / 860"
        caption="Zoom on the hand in frame #5 at 164%. Step with the arrow keys and the next image opens on the same spot."
      />
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
        frame's seed and prompt. A sweep of two or more wildcards opens in Grid as a <b>table</b>. The bar above it picks
        which wildcard goes on <b>Rows</b> and which on <b>Columns</b> (⇄ swaps them); any others
        <b>Split by</b>, one small grid per value. Click a row, column or group name to pick all of
        it. <b>Layout › Frames</b> switches back to the list.
      </p>
      <DocImage
        src="images/docs/wp-image-filter-grid.png"
        ratio="1720 / 644"
        caption="A sweep of $time × $medium × $mood as a table: rows and columns, split by $mood."
      />
      <p>
        <b>Send to Loop</b> writes your picks back to the loop: the picked frames' seeds are
        locked (when the loop overrides seeds) and every other frame is bypassed, so the next run
        repeats only what you kept.
      </p>
    </DocSection>

    <DocSection title="Refine before it goes on">
      <p>
        In <b>Detail</b>, the side panel edits the frame's positive and negative prompt and
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
        <li>While painting, a ring under the mouse is the brush at its real size (dashed for the
          eraser).</li>
      </ul>
      <DocImage
        src="images/docs/wp-image-filter-refine.png"
        ratio="1720 / 860"
        caption="Detail on frame 3: its size, seed and values, the prompt with each value marked, the negative, and Paint for a mask. The strip below jumps to any image."
      />
      <figure class="wp-doc-figure">
        <img :src="picksDiagram" alt="How the picks carry over: images, latents, masks, conditioning and prompt text of picked frames go on; an edited prompt is re-encoded and a painted mask goes to the masks output." loading="lazy">
      </figure>
      <DocFigureText figure="images/how-picks-carry-over.webp" caption="How the picks carry over" />
    </DocSection>

    <DocSection title="Settings on the node">
      <DocImage
        src="images/docs/wp-image-filter.png"
        ratio="2 / 1"
        caption="WP Image Filter after a run, next to a Preview Image of the three images it kept."
      />
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
.wp-doc-figure img { display: block; max-width: 100%; height: auto; border-radius: min(8px, var(--wp-radius-cap, 999px)); border: 1px solid var(--wp-border, #34343a); }
</style>
