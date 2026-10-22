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
  { term: "default", desc: "The value to use when the variable is missing, has no numbers in it, or the index is beyond what was found. The node never stops the run; it uses this instead." },
  { term: "value (out)", desc: "The whole number, for any INT input: width, steps, batch size and so on." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Var → Int"
    icon="pi pi-hashtag"
    tone="node"
    node-id="WP_VarToInt"
    blurb="Turn a number in a $variable into a whole-number input, such as a width or a step count."
  >
    <DocSection title="What it's for">
      <p>
        A pick can hold a number: a size like <VarToken>1920x1080</VarToken>, a step count like
        <VarToken>30 steps</VarToken>, or just <VarToken>512</VarToken>. <b>WP Var → Int</b> takes
        the number out and gives it to any node that wants a whole number. If there's no number,
        it gives your default.
      </p>
      <DocImage
        src="images/docs/wp-var-to-int.png"
        ratio="16 / 6"
        caption="WP Var → Int reads $resolution (1024) and sends it to Empty Latent Image's width."
      />
    </DocSection>

    <DocSection title="When to use it">
      <DocUseWhen
        :good="[
          'A pick that drives a whole number: $steps, a width or height, a seed',
        ]"
        :better="[
          'Text that should stay in the prompt',
        ]"
      />
      <DocCallout variant="tip">
        Hide the variable it reads (the globe on its row), so the value doesn't print in the prompt. The node re-runs only when that value changes.
      </DocCallout>
    </DocSection>

    <DocSection title="Controls">
      <DocKeyList :items="controls" />
    </DocSection>

    <DocSection title="How it finds the number">
      <p>
        The node finds every whole number in the text (a minus sign counts), in order, and
        <b>index</b> picks one:
      </p>
      <ul>
        <li>
          <VarToken>1920x1080</VarToken>: index 0 gives 1920, index 1 gives 1080
        </li>
        <li>
          <VarToken>30 steps</VarToken>: index 0 gives 30
        </li>
        <li>
          <VarToken>hello</VarToken>: no number, so the default
        </li>
      </ul>
      <DocCallout variant="tip">
        For width and height from one <VarToken>$resolution</VarToken>, use two WP Var → Int
        nodes on the same variable: index 0 for width, index 1 for height.
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
