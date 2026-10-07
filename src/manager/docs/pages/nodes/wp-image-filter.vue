<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const ports = [
  { term: "images", desc: "The images to pick from. Required: this is what the picker shows." },
  { term: "latent, masks", desc: "Sliced to the picked images." },
  { term: "positive, negative", desc: "CONDITIONING. A batched conditioning is sliced with the images; a single one is kept for every frame that keeps an image." },
  { term: "positive_text, negative_text", desc: "The prompt strings, kept or dropped with their frame." },
  { term: "context", desc: "Each frame's WP Context, kept or dropped with it." },
  { term: "extra_1, extra_2", desc: "Any type. The output takes the type of what you connect. Batched values are sliced, anything else follows its frame." },
  { term: "picks (out)", desc: "What was kept, as frame:image (1-based), for example 1:2, 3:1." },
];

const keys = [
  { term: "Click", desc: "Pick or unpick an image. Clicking a frame's label picks the whole frame; Ctrl+A picks everything." },
  { term: "Space", desc: "Zoom the image under the mouse. In the zoom, ←/→ move and ↑ picks." },
  { term: "Enter", desc: "Keep the picks and let the run go on." },
  { term: "Escape", desc: "Tuck the picker away. A waiting pill at the bottom of the screen opens it again, picks intact." },
];

const settings = [
  { term: "Mode", desc: "Pause & pick asks every run. Reuse last picks keeps the same picks without asking, and asks again when they no longer fit. Pass all lets everything through." },
  { term: "Nothing picked", desc: "Stop this branch, or keep all." },
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
        A short chime plays when the picker opens, so you hear it from another tab. Turn it off
        with <b>Image Filter sound</b> in Settings.
      </DocCallout>
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
