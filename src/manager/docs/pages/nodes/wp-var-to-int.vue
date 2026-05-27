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
  { term: "index", desc: "Which number to extract when the variable contains more than one. 0 gives the first, 1 the second, and so on. Most variables only have one number, so leave this at 0." },
  { term: "default", desc: "The value to use when the variable is missing, has no numbers in it, or the index is beyond what was found. The node never errors — it always falls back to this." },
  { term: "value (out)", desc: "The extracted integer, ready to wire into any node that accepts INT — image width, step count, batch size, and so on." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Var → Int"
    icon="pi pi-hashtag"
    tone="node"
    node-id="WP_VarToInt"
    blurb="Pull a number out of a $variable and use it as a real INT. Great for driving image dimensions, step counts, or any numeric input from a wildcard pick."
  >
    <DocSection title="What it's for">
      <p>
        Sometimes a wildcard pick contains a number — a resolution like
        <VarToken>1920x1080</VarToken>, a step count like <VarToken>30 steps</VarToken>, or
        just a plain value like <VarToken>512</VarToken>. <b>WP Var → Int</b> extracts the
        number and emits it as a proper integer you can wire into any node that expects one.
        If the variable is missing or contains no recognisable number, it quietly returns the
        default you set — it never stops the run.
      </p>
      <DocImage
        src="images/docs/wp-var-to-int.png"
        ratio="16 / 5"
        caption="The WP Var → Int node with its var_name picker open, showing the list of available $variables. Its INT output connects to the width input of an Empty Latent Image node."
      />
    </DocSection>

    <DocSection title="Controls">
      <DocKeyList :items="controls" />
    </DocSection>

    <DocSection title="How the extraction works">
      <p>
        The node scans the variable's text value for signed integers and collects them in
        order. The <b>index</b> control selects which one to return:
      </p>
      <ul>
        <li>
          <VarToken>1920x1080</VarToken> — index 0 → 1920, index 1 → 1080
        </li>
        <li>
          <VarToken>30 steps</VarToken> — index 0 → 30
        </li>
        <li>
          <VarToken>hello</VarToken> — no numbers found → returns default
        </li>
      </ul>
      <DocCallout variant="tip">
        To extract both width and height from a single <VarToken>$resolution</VarToken>
        variable, place two WP Var → Int nodes reading the same variable: one with index 0
        for width and one with index 1 for height.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-var-to-float', label: 'WP Var → Float', icon: 'pi pi-hashtag', tone: 'node' },
          { id: 'wp-var-to-bool', label: 'WP Var → Bool', icon: 'pi pi-check-square', tone: 'node' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
