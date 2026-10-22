<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocDetails from "../../../components/docs/DocDetails.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const ports = [
  { term: "context (in)", desc: "The variables from a WP Context (or anything that ends in one)." },
  { term: "template", desc: "Your prompt with $variables in it." },
  { term: "negative_template", desc: "Optional, in the collapsible negative section. Your standing negative, with $negatives where the collected negative words go." },
  { term: "prompt (out)", desc: "The finished prompt. Wire it into CLIP Text Encode or a WP Prompt Cleaner." },
  { term: "negative (out)", desc: "The negative words of the variables this template printed, plus your negative template. Wire it into your negative CLIP Text Encode." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Prompt Assembler"
    icon="pi pi-align-left"
    tone="node"
    node-id="WP_PromptAssembler"
    blurb="Write a template with $variables and get a finished prompt, plus a matching negative."
  >
    <DocSection title="What it does">
      <p>
        Write <VarToken>a $style portrait of $subject, $lighting</VarToken> and the Assembler puts
        each variable's value in its place, every run. The result is plain text for CLIP Text
        Encode. Variables you set to <b>Hide from prompt</b> print nothing.
      </p>
      <DocUseWhen
        :good="[
          'One per prompt you need: the main prompt, a face detailer, one per region',
          'Each reads the same Context, so their picks agree',
        ]"
        :better="[
          'Rolling anything: it has no seed. Pick in a wildcard and use its $variable',
        ]"
      />
      <DocImage
        src="images/docs/wp-prompt-assembler.png"
        ratio="16 / 7"
        caption="The Assembler with a template, its variable chips and the resolved preview. A variable nothing sets is underlined and shown as a dashed chip."
      />
    </DocSection>

    <DocSection title="Write a template">
      <ul>
        <li>Type <code>$</code> and pick a variable, or click a chip in the <b>variables</b> strip
          to insert it at the cursor.</li>
        <li>A variable nothing sets is underlined in amber and shows as a dashed chip, and prints
          nothing when you run. Click the chip to remove it from the template.</li>
        <li><code>$$</code> prints a single dollar sign.</li>
        <li><b>Save</b> and <b>Load</b> in the toolbar keep templates in your library (see
          <DocRef id="templates" />).</li>
      </ul>
      <DocCallout variant="warn">
        The Assembler doesn't roll. <code>{a|b|c}</code> prints exactly as typed and
        <code>@{…}</code> prints nothing. Put choices in a wildcard or combine and print its
        variable.
      </DocCallout>
      <DocDetails title="How empty variables are tidied">
        <p>
          When a variable comes out empty, the commas around it and a joining word left with nothing
          after it ("with", "and") are removed. Your own words stay: with
          <VarToken>$hat</VarToken>, <VarToken>$scarf</VarToken> and <VarToken>$place</VarToken>
          empty, <code>a girl wearing $hat with $scarf, $pose, in the $place</code> gives "a girl
          wearing, sitting". Write templates that still read well when something is empty (put the
          verb inside a combine), and use WP Prompt Cleaner to remove duplicates. Emoticon tags such
          as <code>:d</code> are kept.
        </p>
      </DocDetails>
    </DocSection>

    <DocSection title="The negative output">
      <p>
        Wildcard options, fixed values, combines and derivations can carry negative words. The
        <code>negative</code> output collects them, but only for variables this template printed: an
        Assembler for a face detailer that prints just <VarToken>$face</VarToken> never gets the
        hair negatives.
      </p>
      <DocImage
        src="images/docs/assembler-negative.png"
        ratio="16 / 7"
        caption="Hair, Weather and Quality feed an Assembler with both outputs wired. The negative preview shows the words collected from the variables the template printed."
      />
      <ul>
        <li>Put your standing negative in the negative template, e.g.
          <code>lowres, bad anatomy, $negatives</code>.</li>
        <li>Leave it empty to output only the collected words. Without
          <VarToken>$negatives</VarToken> they're added at the end.</li>
        <li>Repeated tags are dropped, also when written with a weight like
          <code>(blurry:1.2)</code>.</li>
        <li><b>Clear template</b> empties the negative template too.</li>
      </ul>
      <p>More in <DocRef id="negatives" />.</p>
    </DocSection>

    <DocSection title="Inputs and outputs">
      <DocKeyList :items="ports" />
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'variable-pipeline', label: 'The $variable pipeline', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'negatives', label: 'Negatives', icon: 'pi pi-minus-circle', tone: 'neutral' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'wp-prompt-cleaner', label: 'WP Prompt Cleaner', icon: 'pi pi-ban', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
