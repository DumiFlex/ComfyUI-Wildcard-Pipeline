<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const controls = [
  { term: "context (in)", desc: "The upstream Context carrying the $variable you want to read." },
  { term: "var_name", desc: "Pick the $variable to parse from the dropdown. The list updates automatically with every variable available in the upstream Context." },
  { term: "index", desc: "Which number to extract when the variable contains more than one. 0 gives the first, 1 the second, and so on. Leave at 0 for single-value variables." },
  { term: "default", desc: "The value to use when the variable is missing, has no numbers in it, or the index is beyond what was found. The node never errors — it always falls back to this." },
  { term: "value (out)", desc: "The extracted float, ready to wire into any node that accepts FLOAT — CFG scale, denoising strength, and similar inputs." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Var → Float"
    icon="pi pi-hashtag"
    tone="node"
    node-id="WP_VarToFloat"
    blurb="Pull a decimal number out of a $variable and use it as a real FLOAT. Ideal for driving CFG scale, denoising strength, or any decimal input from a wildcard pick."
  >
    <DocSection title="What it's for">
      <p>
        When a wildcard pick contains a decimal value — <VarToken>0.75</VarToken>,
        <VarToken>cfg 7.5</VarToken>, or even a plain integer like <VarToken>8</VarToken>
        — <b>WP Var → Float</b> extracts it and emits it as a proper float you can wire
        into any node that expects one. Plain integers match too, so you can use this node
        wherever you need FLOAT output even if your variable only ever holds whole numbers.
        Missing variables or ones with no recognisable number quietly return the default.
      </p>
      <DocImage
        ratio="16 / 5"
        caption="The WP Var → Float node with its var_name picker open. Its FLOAT output connects to the cfg input of a KSampler node."
      />
    </DocSection>

    <DocSection title="Controls">
      <DocKeyList :items="controls" />
    </DocSection>

    <DocSection title="How the extraction works">
      <p>
        The node scans the variable's text for decimal and scientific-notation numbers.
        Whole integers match too:
      </p>
      <ul>
        <li><VarToken>cfg 7.5</VarToken> — index 0 → 7.5</li>
        <li><VarToken>1920x1080</VarToken> — index 0 → 1920.0, index 1 → 1080.0</li>
        <li><VarToken>1.5e-3</VarToken> — index 0 → 0.0015</li>
        <li><VarToken>hello</VarToken> — no numbers found → returns default</li>
      </ul>
      <DocCallout variant="tip">
        Because whole integers match the float pattern, WP Var → Float works as a drop-in
        when you need a FLOAT output from a variable that holds a whole number.
      </DocCallout>
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
