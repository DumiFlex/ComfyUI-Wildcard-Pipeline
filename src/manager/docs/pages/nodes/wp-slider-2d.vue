<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import Banner from "@/kit/Banner.vue";
import DocFields from "../../../components/docs/DocFields.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Slider 2D"
    icon="pi pi-th-large"
    tone="node"
    node-id="WP_Slider2D"
    blurb="One XY pad: drag a point to set two numbers at once. Each axis writes a $variable like a WP Slider slider and has its own INT or FLOAT output."
  >
    <DocSection title="What it's for">
      <p>
        <b>WP Slider 2D</b> is one pad with a point on it. Dragging the point sets two numbers at once:
        X across, Y up. Each axis is a slider of its own, so it writes
        <VarToken>$its_variable</VarToken> (the number, your text or a word per range), its number is
        read by <VarToken>$name.num</VarToken>, and it drives its own output, <code>x</code> or
        <code>y</code>. Like WP Slider, the pad is part of the node, so it works in the new Vue node
        mode.
      </p>
      <p>
        With <b>Auto</b> dots, a dot sits on every step of each axis, so a 64-step Width × Height pad
        shows where each size lands; turn on <b>Snap to dots</b> and the point only lands on them.
      </p>
    </DocSection>

    <DocSection title="When to use it">
      <DocUseWhen
        :good="[
          'A picture size: Width across, Height up, wired into an Empty Latent Image, in the Size style with Auto shape so the shaded box looks like the picture and the guide lines show 1:1, 4:3 and 16:9',
          'A camera pan or tilt from -1 to 1 in the Stick style, zero in the middle',
          'Two numbers you tune together: cfg and steps, two LoRA strengths',
          'A mood map: calm to wild across, dark to bright up, each axis in Words mode, in the Map style so the words are written on the pad',
        ]"
        :better="[
          'Numbers you set one at a time: WP Slider',
          'A number a random pick should choose: a wildcard and WP Var → Float',
        ]"
      />
    </DocSection>

    <DocSection title="Controls">
      <DocFields node="WP_Slider2D" group="controls" />
    </DocSection>

    <DocSection title="Editing an axis">
      <DocFields node="WP_Slider2D" group="edit" />
      <Banner tone="info" note>
        Each axis's Words, Text and $name.num work exactly as in
        <b>WP Slider</b>: a Mood axis in Words mode writes <code>calm</code> up to 0.5 and
        <code>wild</code> past it, and <VarToken>$mood.num</VarToken> still reads the number.
      </Banner>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-slider', label: 'WP Slider', icon: 'pi pi-sliders-h', tone: 'node' },
          { id: 'wp-toggles', label: 'WP Toggles', icon: 'pi pi-check-square', tone: 'node' },
          { id: 'wp-var-to-int', label: 'WP Var → Int', icon: 'pi pi-hashtag', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
