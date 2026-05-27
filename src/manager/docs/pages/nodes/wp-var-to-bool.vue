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
  { term: "index", desc: "Which boolean token to use when the variable contains more than one recognised value. 0 gives the first match, 1 the second. Words like \"maybe\" or numbers like 1.5 are ignored and do not count toward the index." },
  { term: "default", desc: "The value to use when the variable is missing or contains no recognised boolean words. The node never errors — it always falls back to this." },
  { term: "value (out)", desc: "The parsed boolean, ready to wire into any node that accepts BOOLEAN — sampler toggles, switch nodes, and so on." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Var → Bool"
    icon="pi pi-check-square"
    tone="node"
    node-id="WP_VarToBool"
    blurb="Parse a true/false decision from a $variable. Use a wildcard with on/off options to make any ComfyUI boolean input probabilistic."
  >
    <DocSection title="What it's for">
      <p>
        <b>WP Var → Bool</b> reads a <VarToken>$variable</VarToken> from the upstream
        Context and interprets its text as a boolean. Words like <code>true</code>,
        <code>yes</code>, <code>on</code>, and <code>1</code> become <code>true</code>;
        words like <code>false</code>, <code>no</code>, <code>off</code>, and <code>0</code>
        become <code>false</code>. Wire the output into any node that accepts BOOLEAN — a
        sampler toggle, a switch, a boolean math node — to make that switch probabilistic.
      </p>
      <DocImage
        src="images/docs/wp-var-to-bool.png"
        ratio="16 / 5"
        caption="The WP Var → Bool node with its var_name picker showing a $hires_fix variable. Its BOOLEAN output connects to the enabled input of an upscaler node."
      />
    </DocSection>

    <DocSection title="Controls">
      <DocKeyList :items="controls" />
    </DocSection>

    <DocSection title="How the parsing works">
      <p>
        The node splits the variable's value on spaces, commas, semicolons, pipes, and
        slashes, then checks each piece against the recognised word lists
        (case-insensitive). Words that match neither list are skipped entirely — they do
        not advance the index:
      </p>
      <ul>
        <li>Truthy words: <code>true</code>, <code>yes</code>, <code>on</code>, <code>1</code></li>
        <li>Falsy words: <code>false</code>, <code>no</code>, <code>off</code>, <code>0</code></li>
        <li>Everything else (e.g. <code>maybe</code>, <code>1.5</code>, <code>hello</code>) is ignored</li>
      </ul>
      <p>
        So a variable value of <VarToken>true maybe false</VarToken> has two boolean
        tokens: index 0 → <code>true</code>, index 1 → <code>false</code>.
      </p>
      <DocCallout variant="tip">
        Add a wildcard with options <code>on</code> / <code>off</code> and wire it through
        WP Var → Bool to randomly enable or disable any boolean input in your workflow.
      </DocCallout>
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
