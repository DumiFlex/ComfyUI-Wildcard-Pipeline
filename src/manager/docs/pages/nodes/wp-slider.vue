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
    title="WP Slider"
    icon="pi pi-sliders-h"
    tone="node"
    node-id="WP_Slider"
    blurb="Several number sliders in one node. Each writes a $variable (the number, your text, or a word per range) and can have an INT or FLOAT output."
  >
    <DocSection title="What it's for">
      <p>
        <b>WP Slider</b> holds as many sliders as you need, each on its own row. A slider writes
        <VarToken>$its_variable</VarToken> for prompts and rules, and can show a number output at the
        right of its row for a sampler's steps or cfg, a LoRA strength or any other number input
        (off for a new slider: turn on its output in its window). It draws its sliders as part of
        the node, so it works in the new Vue node mode where canvas-drawn sliders don't.
      </p>
    </DocSection>

    <DocSection title="When to use it">
      <DocUseWhen
        :good="[
          'Numbers you set by hand: LoRA strengths, steps, cfg, a detail weight',
          'One number that feeds both a prompt and a node: (intricate details:$detail.num) and a FLOAT output',
          'A dial that picks words: camera distance from close-up to wide shot',
        ]"
        :better="[
          'A number a random pick should choose: a wildcard and WP Var → Float',
          'An on/off choice: WP Toggles',
        ]"
      />
    </DocSection>

    <DocSection title="Controls">
      <DocFields node="WP_Slider" group="controls" />
    </DocSection>

    <DocSection title="Editing a slider">
      <DocFields node="WP_Slider" group="edit" />
      <Banner tone="info" note>
        Drag the grip to reorder. A label moves with its sliders. Moving a row never re-points a
        wire: each output stays with its slider.
      </Banner>
    </DocSection>

    <DocSection title="Number, text or words">
      <p>
        A slider's <b>Value</b> decides what <VarToken>$its_variable</VarToken> holds. <b>Number</b>
        writes the number with the slider's decimals: <code>0.45</code>, or <code>28</code> at 0
        decimals. <b>Text</b> writes a text of your own that can read the number, so a Detail slider
        with the text <code>(intricate details:$detail.num)</code> prints
        <code>(intricate details:1.2)</code>. <b>Words</b> splits the track into ranges, each with a
        word: a Camera slider writes <code>close-up</code> up to 0.3, <code>medium shot</code> up to
        0.7 and <code>wide shot</code> past that, and the wide shot's negative
        <code>cropped</code> goes to the Assembler's negative output only while it is picked.
      </p>
      <p>
        Whatever the variable holds, <VarToken>$camera.num</VarToken> reads the number, in a
        template, a derivation or another slider's text, the way <VarToken>$rain.bool</VarToken>
        reads a toggle's switch. The output always sends the number.
      </p>
      <Banner tone="info" note>
        A pack that reads <code>$name.num</code> needs a Wildcard Pipeline version that knows it to
        install from the community site; older versions refuse it with a message.
      </Banner>
    </DocSection>

    <DocSection title="Row, bar or fader">
      <p>
        Each slider picks its <b>Style</b> in its window. <b>Row</b> puts the name in a column and a
        thin track after it, so every track starts at the same place. <b>Bar</b> makes the whole row
        the track, with the name inside it, for a LoRA strength you grab anywhere. <b>Fader</b>
        stands the track up, value on top and name under it; faders next to each other stand side
        by side like a mixing desk, and their output dots line up beside a list of their names. Mix
        them freely: a Sampler group of rows above a group of faders.
      </p>
      <p>
        A drag lands on the slider's step. Hold <b>Shift</b> while dragging to land on any value its
        decimals can write, or turn off <b>Snap to step</b> to drag that finely all the time (the
        arrow keys still move by the step).
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-toggles', label: 'WP Toggles', icon: 'pi pi-check-square', tone: 'node' },
          { id: 'wp-var-to-float', label: 'WP Var → Float', icon: 'pi pi-hashtag', tone: 'node' },
          { id: 'wp-var-to-int', label: 'WP Var → Int', icon: 'pi pi-hashtag', tone: 'node' },
          { id: 'wp-context-injector', label: 'WP Context Injector', icon: 'pi pi-sign-in', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
