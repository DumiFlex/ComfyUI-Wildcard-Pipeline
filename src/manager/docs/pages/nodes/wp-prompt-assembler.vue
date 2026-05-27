<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const ports = [
  { term: "context (in)", desc: "The resolved variable map from any WP Context chain. Required — without it the node has no values to substitute." },
  { term: "template", desc: "Your prompt template. Type free text and insert $variable names wherever you want a wildcard pick or fixed value to appear. The multiline editor supports the full variable syntax." },
  { term: "prompt (out)", desc: "The fully resolved prompt string. Wire it directly into a CLIP Text Encode, a WP Prompt Cleaner, or any other node that accepts a STRING." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Prompt Assembler"
    icon="pi pi-align-left"
    tone="node"
    node-id="WP_PromptAssembler"
    blurb="Turn a $variable map into a finished prompt. Write a template with $placeholders and the node fills them in from the upstream Context every run."
  >
    <DocSection title="What it's for">
      <p>
        Write a template like
        <VarToken>a $style portrait of $subject, $lighting</VarToken>
        and the Assembler substitutes every <VarToken>$variable</VarToken> from the upstream
        Context. The result is a plain text string you send straight to a CLIP Text Encode or
        any other text consumer. Variables marked as internal in the Context are kept out of
        the rendered prompt automatically.
      </p>
      <DocImage
        src="images/docs/wp-prompt-assembler.png"
        ratio="16 / 7"
        caption="The WP Prompt Assembler node showing the template field with $variable placeholders, the variable chip strip below it with each upstream binding listed, and the resolved preview text."
      />
    </DocSection>

    <DocSection title="Inputs &amp; output">
      <DocKeyList :items="ports" />
    </DocSection>

    <DocSection title="Writing templates">
      <p>
        The template field supports several ways to write dynamic content:
      </p>
      <ul>
        <li>
          <VarToken>$varname</VarToken> — replaced with the value from the Context.
          If no binding exists, the placeholder resolves to empty and the canvas preview
          highlights it with an amber underline so you can spot the gap before running.
        </li>
        <li>
          <VarToken kind="inline">{a|b|c}</VarToken> — picks one option at random each run,
          independent of the Context.
        </li>
        <li>
          <code>$$</code> — a literal dollar sign, in case you need one in the output text.
        </li>
      </ul>
      <DocCallout variant="tip">
        The <b>Variables</b> strip below the template lists every upstream binding — click any
        chip to insert <code>$name</code> at the cursor position rather than typing it by hand.
      </DocCallout>
    </DocSection>

    <DocSection title="Save &amp; Load template">
      <p>
        The toolbar buttons let you save the current template to the <b>Templates</b> library
        or load a previously saved one. After loading, the next Save defaults to updating that
        same library entry. Manage all templates in the SPA <b>Templates</b> tab.
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'variable-pipeline', label: 'The $variable pipeline', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'wp-prompt-cleaner', label: 'WP Prompt Cleaner', icon: 'pi pi-ban', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
