<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import Banner from "@/kit/Banner.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocAnnotated from "../../../components/docs/DocAnnotated.vue";
import DocFields from "../../../components/docs/DocFields.vue";
import DocDetails from "../../../components/docs/DocDetails.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

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
      <DocAnnotated
        src="images/docs/wp-prompt-assembler.png"
        ratio="1720 / 860"
        caption="The Assembler with a template, its variable chips and its preview. The preview inside the node rolls each Context on its own seed (or the Int or seed node wired into it), so it is what Run prints and changes with the seed; the two Preview as Text nodes show what the run printed."
      />
    </DocSection>

    <DocSection title="Write a template">
      <ul>
        <li>Type <code>$</code> and pick a variable, or click a chip in the <b>variables</b> strip
          to insert it at the cursor.</li>
        <li>A variable nothing sets is underlined in amber and shows as a dashed chip, and prints
          nothing when you run. Click the chip to remove it from the template.</li>
        <li>With a <b>WP Context Loop</b> upstream, a variable that only some frames set (a module
          switched on or off per frame) is not missing: its chip is blue with a frame tag such as
          <code>#4</code>, the header counts it as <b>on some frames</b>, and pointing at it says
          which frames render it empty. The preview shows one frame, the one picked under the
          Loop's <b>Edit frame</b>; the <b>‹ 1/4 ›</b> arrows above it step through them
          (see <DocRef id="iteration-overrides" />).</li>
        <li><code>$$</code> prints a single dollar sign.</li>
        <li><b>Save</b> and <b>Load</b> in the toolbar keep templates in your library (see
          <DocRef id="templates" />).</li>
      </ul>
      <Banner tone="warn" note>
        The Assembler doesn't roll. <code>{a|b|c}</code> prints exactly as typed and
        <code>@{…}</code> prints nothing. Put choices in a wildcard or combine and print its
        variable.
      </Banner>
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

    <DocSection title="Hide the variables you don't use">
      <p>
        A big Context offers many variables, and most of them feed other variables rather than the
        prompt. The eye button in the <b>variables</b> toolbar (beside Load, Save and Clear) marks
        every variable that neither this template nor the negative template reads as
        <b>internal</b>, so the chip strip and the <code>$</code> list only offer what you print.
      </p>
      <ul>
        <li>Internal only hides a variable from Assemblers. Combines, rules, constraints and the Var
          nodes still read it, so <VarToken>$hero</VarToken> used inside
          <VarToken>$scene</VarToken> keeps working.</li>
        <li>Every other Assembler on the same context is checked first: a variable one of them
          prints (<code>$x.0</code>, <code>$x.AXIS</code> and <code>$x.neg</code> count) is kept.</li>
        <li>A Context module has one internal switch for all the variables it writes, so a fixed
          values module that also writes a variable in use is left as it is.</li>
        <li>It flips the same switches you would: the globe on a module, an Injector row, a toggle,
          a Model Info row or a Loop variable. The message says what it marked and what it kept and
          why; <b>Undo</b> in it puts everything back.</li>
        <li>An Assembler whose template comes from a wire can't tell what it uses, so nothing it can
          see is marked.</li>
      </ul>
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
        <li>A new Assembler starts with <VarToken>$negatives</VarToken>: just the collected words.
          Add your standing negative around it, e.g. <code>lowres, bad anatomy, $negatives</code>.</li>
        <li>Without <VarToken>$negatives</VarToken> the negative is only what you write, and an empty
          box is an empty negative. Workflows saved before this get <VarToken>$negatives</VarToken>
          added when they load, so they print the same.</li>
        <li>Repeated tags are dropped, also when written with a weight like
          <code>(blurry:1.2)</code>.</li>
        <li><b>Clear template</b> empties the negative template too.</li>
      </ul>
      <p>More in <DocRef id="negatives" />.</p>
    </DocSection>

    <DocSection title="In a subgraph">
      <p>
        Inside a subgraph, drag the <code>template</code> or <code>negative_template</code> dot to the
        subgraph's input to edit it from outside. The subgraph node then shows the same editor, with
        the <code>$</code> list of the variables upstream of the Assembler inside. What you type there is
        what the Assembler runs with, and it is saved with the workflow. While a wire feeds that input on
        the outside, the box is read-only.
      </p>
    </DocSection>

    <DocSection title="Inputs and outputs">
      <DocFields node="WP_PromptAssembler" group="ports" />
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
