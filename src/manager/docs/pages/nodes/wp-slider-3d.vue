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
    title="WP Slider 3D"
    icon="pi pi-box"
    tone="node"
    node-id="WP_Slider3D"
    blurb="Three numbers at once: an XY pad with a Z fader, or a camera or a light round the subject that writes words like front-left view, high angle, medium shot."
  >
    <DocSection title="What it's for">
      <p>
        <b>WP Slider 3D</b> sets three numbers together. Each axis is a slider of its own, as in
        <b>WP Slider 2D</b>: it writes <VarToken>$its_variable</VarToken> (the number, your text or a word
        per range), <VarToken>$name.num</VarToken> reads its number, and it has its own output,
        <code>x</code>, <code>y</code> or <code>z</code>.
      </p>
      <p>
        Three ways to draw it. The <b>pad</b> styles are the 2D pad with a <b>Z fader</b> beside it; a
        ring round the point grows with Z. The <b>Orbit</b> style puts a camera or a light round the
        subject: X is the angle round it, Y the height, Z the distance. Its <b>Camera</b> and
        <b>Light</b> words turn the three numbers into one template line, like
        <VarToken>$view</VarToken> = <code>front-left view, high angle, medium shot</code>, ready for a
        prompt or a multi-angle LoRA. The <b>Mix</b> style is a triangle with one thing at each corner:
        drag the point to blend them, and the three shares always add up to 100%, like
        <VarToken>$style_mix</VarToken> = <code>(watercolor:0.40), (ink sketch:0.30), (oil painting:0.30)</code>.
      </p>
    </DocSection>

    <DocSection title="When to use it">
      <DocUseWhen
        :good="[
          'A camera angle for a character or product shot: Orbit with the Camera words, $view in the prompt',
          'Where the key light comes from: Orbit with the Light words, $light in the prompt (backlight, side light from the left, overhead light …)',
          'A blend of three styles, moods or LoRAs that add up to one: Mix, each axis a weight',
          'Three numbers you tune together: cfg, steps and denoise',
        ]"
        :better="[
          'Two numbers: WP Slider 2D',
          'Numbers you set one at a time: WP Slider',
        ]"
      />
    </DocSection>

    <DocSection title="Controls">
      <DocFields node="WP_Slider3D" group="controls" />
    </DocSection>

    <DocSection title="Editing an axis or the template">
      <DocFields node="WP_Slider3D" group="edit" />
      <Banner tone="info" note>
        The Orbit words are ordinary Words ranges, so you can change any of them in the axis window:
        rename <code>medium shot</code> to <code>cowboy shot</code>, or add a range. The back of the
        subject covers both ends of the turn, -180 and 180.
      </Banner>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-slider-2d', label: 'WP Slider 2D', icon: 'pi pi-th-large', tone: 'node' },
          { id: 'wp-slider', label: 'WP Slider', icon: 'pi pi-sliders-h', tone: 'node' },
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
