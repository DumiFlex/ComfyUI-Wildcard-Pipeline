<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import Banner from "@/kit/Banner.vue";
import DocAnnotated from "../../../components/docs/DocAnnotated.vue";
import DocFields from "../../../components/docs/DocFields.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

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
      <DocAnnotated
        src="images/docs/wp-var-to-int.png"
        ratio="1720 / 644"
        caption="WP Var → Int reads $size ('832x1216', the Render Context's pick for an sdxl model) at index 0 and sends 832 to Empty Latent Image's width."
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
      <Banner tone="info" note>
        Hide the variable it reads (the globe on its row), so the value doesn't print in the prompt. The node re-runs only when that value changes.
      </Banner>
    </DocSection>

    <DocSection title="Controls">
      <DocFields node="WP_VarToInt" group="controls" />
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
      <Banner tone="info" note>
        For width and height from one <VarToken>$resolution</VarToken>, use two WP Var → Int
        nodes on the same variable: index 0 for width, index 1 for height.
      </Banner>
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
