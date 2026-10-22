<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocFigure from "../../../components/docs/DocFigure.vue";
import PipelineDiagram from "../../../components/docs/PipelineDiagram.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
import DocRef from "../../../components/docs/DocRef.vue";
</script>

<template>
  <DocPage
    group="How it connects"
    title="The $variable pipeline"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="How modules fill $variables and the Assembler turns them into a prompt, and which syntax works where."
  >
    <DocSection title="How it works">
      <p>
        A <b>WP Context</b> runs its modules from top to bottom. Each one writes a value into a
        <VarToken>$variable</VarToken>: the wildcard picks "a fox" for
        <VarToken>$subject</VarToken>, the fixed value sets <VarToken>$style</VarToken> to
        "watercolor". The finished set of variables goes to the next node. The
        <b>WP Prompt Assembler</b> then swaps every <VarToken>$name</VarToken> in your template for
        its value.
      </p>
    </DocSection>

    <DocSection title="What you can write">
      <table class="wp-doc-syntax-table">
        <thead>
          <tr>
            <th>Write</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><VarToken>$name</VarToken></td>
            <td>The variable's value. If the wildcard picked several options, all of them, joined by
              its separator.</td>
          </tr>
          <tr>
            <td><VarToken>$name.0</VarToken></td>
            <td>One of several picks, counting from 0: <VarToken>$colors.0</VarToken> is the first.
              A number past the end prints nothing.</td>
          </tr>
          <tr>
            <td><VarToken>$name.GROUP</VarToken></td>
            <td>The tag rolled from an accepts tag group: <VarToken>$outfit.SHOES</VarToken> is the
              shoe that goes with this run's outfit. It's rolled once, so it's the same everywhere.
              With several picks, <VarToken>$outfit.0.SHOES</VarToken> is the first one's. A group
              that isn't accepts prints nothing and gets a warning.</td>
          </tr>
          <tr>
            <td><VarToken>$name.neg</VarToken></td>
            <td>The variable's negative words. See <DocRef id="negatives" />.</td>
          </tr>
          <tr>
            <td><VarToken kind="ref">@{…}</VarToken></td>
            <td>A fresh pick from another wildcard. Type <b>@</b> to insert one; it shows as a chip.
              It can narrow the pick to some tags (<code>warm or cool</code>) or leave out the null
              option. Written out it looks like
              <VarToken kind="ref">@{abcd1234#Mood:calm or intense!null}</VarToken>: the 8-letter
              id, then an optional name, filter and <code>!null</code>. More in
              <DocRef id="chips-and-references" />.</td>
          </tr>
          <tr>
            <td><VarToken kind="inline">{a|b|c}</VarToken></td>
            <td>Picks one part each run. <VarToken kind="inline">{3::cat|dog}</VarToken> makes cat
              three times as likely.</td>
          </tr>
          <tr>
            <td><VarToken kind="inline">{2$$a|b|c}</VarToken></td>
            <td>Picks two different parts, joined by a comma.
              <VarToken kind="inline">{2$$ and $$a|b|c}</VarToken> joins them with " and ";
              <VarToken kind="inline">{1-3$$a|b|c}</VarToken> picks between one and three. Add
              <code>~</code> (<VarToken kind="inline">{2~$$a|b|c}</VarToken>) to allow the same
              part twice.</td>
          </tr>
          <tr>
            <td><VarToken kind="inline">$$</VarToken> · <VarToken kind="inline">@@</VarToken> · <VarToken kind="inline">&#123;&#123;</VarToken></td>
            <td>Print a plain <code>$</code>, <code>@</code> or <code>&#123;</code>.</td>
          </tr>
        </tbody>
      </table>
      <DocCallout variant="tip">
        These nest: a part of <VarToken kind="inline">{…}</VarToken> can hold a reference or another
        choice, such as <VarToken kind="inline">{a @{abcd1234} cat|{2$$, $$red|blue|green} sky}</VarToken>.
      </DocCallout>
      <p>
        <b>Naming a variable:</b> letters, digits and underscores, starting with a letter or
        underscore, up to 64 characters. Names starting with two underscores are kept for the
        engine.
      </p>
    </DocSection>

    <DocSection title="Which syntax works where">
      <p>
        Not every field reads everything. Anything a field doesn't read prints as typed, except
        where the table says "nothing" (it prints nothing and WP Debug notes it).
      </p>
      <table class="wp-doc-syntax-table wp-doc-gate-table">
        <thead>
          <tr>
            <th>Field</th>
            <th><VarToken>$var</VarToken></th>
            <th><VarToken kind="ref">@{…}</VarToken></th>
            <th><VarToken kind="inline">{a|b}</VarToken></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Wildcard option</td>
            <td>—</td>
            <td>✓</td>
            <td>✓</td>
          </tr>
          <tr>
            <td>Fixed value</td>
            <td>—</td>
            <td>—</td>
            <td>✓</td>
          </tr>
          <tr>
            <td>Combine template</td>
            <td>✓</td>
            <td>nothing</td>
            <td>✓</td>
          </tr>
          <tr>
            <td>Derivation "then" value</td>
            <td>✓</td>
            <td>✓</td>
            <td>✓</td>
          </tr>
          <tr>
            <td>Derivation "if" value</td>
            <td>—</td>
            <td>—</td>
            <td>—</td>
          </tr>
          <tr>
            <td>Assembler template</td>
            <td>✓</td>
            <td>nothing</td>
            <td>as typed</td>
          </tr>
        </tbody>
      </table>
      <DocCallout variant="warn">
        Wildcard options and fixed values can't read a <VarToken>$variable</VarToken>, wherever
        they sit. To build text from earlier picks, use a <b>Combine</b> or a <b>Derivation</b>
        below them.
      </DocCallout>
      <DocCallout variant="tip">
        The Assembler doesn't roll anything, so put choices in a wildcard or combine and print its
        variable. A derivation's "if" compares one variable (<VarToken>$name.0</VarToken>,
        <VarToken>$name.GROUP</VarToken> and <VarToken>$name.neg</VarToken> work too) with plain
        text.
      </DocCallout>
    </DocSection>

    <DocSection title="The flow">
      <DocFigure figure="variable-pipeline-figure" caption="Modules produce $vars inside a Context; the Assembler fills the template.">
        <PipelineDiagram />
      </DocFigure>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>

<style scoped>
.wp-doc-syntax-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg);
  overflow: hidden;
  font-size: 12.5px;
}
.wp-doc-syntax-table th {
  text-align: left;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--wp-text-dim);
  font-weight: 600;
  padding: 9px 14px;
  background: var(--wp-bg-2);
  border-bottom: 1px solid var(--wp-border);
}
.wp-doc-syntax-table td {
  padding: 9px 14px;
  border-bottom: 1px solid var(--wp-border);
  vertical-align: top;
  color: var(--wp-text-muted);
  line-height: 1.55;
}
.wp-doc-syntax-table tr:last-child td { border-bottom: none; }

/* Gate table: first column is the surface label (left), the three token
   columns are short markers (✓ / literal / —) that read best centred. */
.wp-doc-gate-table th:not(:first-child),
.wp-doc-gate-table td:not(:first-child) { text-align: center; }
.wp-doc-gate-table td:first-child { color: var(--wp-text); font-weight: 500; }
</style>
