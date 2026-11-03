<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import Banner from "@/kit/Banner.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocFields from "../../../components/docs/DocFields.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Var → Bool"
    icon="pi pi-check-square"
    tone="node"
    node-id="WP_VarToBool"
    blurb="Turn a yes/no in a $variable into a true/false input. A wildcard with on and off can flip any switch at random."
  >
    <DocSection title="What it's for">
      <p>
        <b>WP Var → Bool</b> reads a <VarToken>$variable</VarToken> as true or false.
        <code>true</code>, <code>yes</code>, <code>on</code> and <code>1</code> are true;
        <code>false</code>, <code>no</code>, <code>off</code> and <code>0</code> are false. Wire
        it into a switch or toggle, and a wildcard pick decides whether it's on.
      </p>
      <DocImage
        src="images/docs/wp-var-to-bool.png"
        ratio="16 / 6"
        caption="WP Var → Bool reads $hires ('yes') and outputs True."
      />
    </DocSection>

    <DocSection title="When to use it">
      <DocUseWhen
        :good="[
          'A pick that flips a switch in the graph: $hires into a switch node, a detailer on or off',
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
      <DocFields node="WP_VarToBool" group="controls" />
    </DocSection>

    <DocSection title="How it reads the text">
      <p>
        The node splits the text at spaces, commas, semicolons, pipes and slashes and checks each
        word (capitals don't matter). Other words are skipped and don't count for the index:
      </p>
      <ul>
        <li>True: <code>true</code>, <code>yes</code>, <code>on</code>, <code>1</code></li>
        <li>False: <code>false</code>, <code>no</code>, <code>off</code>, <code>0</code></li>
        <li>Everything else (e.g. <code>maybe</code>, <code>1.5</code>, <code>hello</code>) is ignored</li>
      </ul>
      <p>
        So <VarToken>true maybe false</VarToken> has two: index 0 is <code>true</code>, index 1 is
        <code>false</code>.
      </p>
      <Banner tone="info" note>
        A wildcard with options <code>on</code> and <code>off</code> through WP Var → Bool switches
        any true/false input at random. Weights set how often.
      </Banner>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-var-to-int', label: 'WP Var → Int', icon: 'pi pi-hashtag', tone: 'node' },
          { id: 'wp-var-to-float', label: 'WP Var → Float', icon: 'pi pi-hashtag', tone: 'node' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
