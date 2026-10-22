<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const controls = [
  { term: "context (in)", desc: "The Context that holds the $variable." },
  { term: "var_name", desc: "The $variable to read. The list shows every variable the wired Context has." },
  { term: "index", desc: "Which number to take when there are several: 0 is the first, 1 the second. Usually 0." },
  { term: "default", desc: "Used when the variable is missing, has no number, or has fewer numbers than the index. The node never stops the run; it uses this instead." },
  { term: "value (out)", desc: "The number, for any FLOAT input: CFG, denoise, a LoRA strength and so on." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Var → Float"
    icon="pi pi-hashtag"
    tone="node"
    node-id="WP_VarToFloat"
    blurb="Turn a number in a $variable into a decimal input, such as CFG or denoise."
  >
    <DocSection title="What it's for">
      <p>
        A pick can hold a number such as <VarToken>0.75</VarToken>, <VarToken>cfg 7.5</VarToken>
        or <VarToken>8</VarToken>. <b>WP Var → Float</b> takes it out and gives it to any node
        that wants a decimal. Whole numbers work too. If there's no number, it gives your
        default.
      </p>
      <DocImage
        src="images/docs/wp-var-to-float.png"
        ratio="16 / 6"
        caption="WP Var → Float reads $cfg (7.5) and sends it to the KSampler's cfg."
      />
    </DocSection>

    <DocSection title="When to use it">
      <DocUseWhen
        :good="[
          'A pick that drives a decimal: $cfg, a LoRA strength, a denoise',
        ]"
        :better="[
          'Text that should stay in the prompt',
        ]"
      />
      <DocCallout variant="tip">
        Hide the variable it reads (the globe on its row), so the value doesn't print in the prompt. A derivation can write it from another pick (“if $model_family is flux, $cfg is 1”). The node re-runs only when that value changes.
      </DocCallout>
    </DocSection>

    <DocSection title="Controls">
      <DocKeyList :items="controls" />
    </DocSection>

    <DocSection title="How it finds the number">
      <p>
        The node finds every number in the text, in order, and <b>index</b> picks one:
      </p>
      <ul>
        <li><VarToken>cfg 7.5</VarToken>: index 0 gives 7.5</li>
        <li><VarToken>1920x1080</VarToken>: index 0 gives 1920.0, index 1 gives 1080.0</li>
        <li><VarToken>1.5e-3</VarToken>: index 0 gives 0.0015</li>
        <li><VarToken>hello</VarToken>: no number, so the default</li>
      </ul>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-var-to-int', label: 'WP Var → Int', icon: 'pi pi-hashtag', tone: 'node' },
          { id: 'wp-var-to-bool', label: 'WP Var → Bool', icon: 'pi pi-check-square', tone: 'node' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
