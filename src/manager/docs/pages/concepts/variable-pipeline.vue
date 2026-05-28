<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocFigure from "../../../components/docs/DocFigure.vue";
import PipelineDiagram from "../../../components/docs/PipelineDiagram.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="How it connects"
    title="The $variable pipeline"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="How modules produce $vars and the Assembler fills templates — syntax, surfaces, and gating."
  >
    <DocSection title="The pipeline">
      <p>
        When a <b>WP Context</b> runs, it works through its module stack from top to bottom. Each
        module produces one or more <VarToken>name = value</VarToken> bindings. Those bindings
        build up inside the Context and are then passed downstream to Assemblers, other Contexts,
        or Debug nodes. The Assembler's job is to take your prompt template and swap in the
        values — every <VarToken>$name</VarToken> token becomes the value that was set upstream.
      </p>
    </DocSection>

    <DocSection title="Syntax reference">
      <p>The following constructs are recognised inside template strings and wildcard option text:</p>
      <table class="wp-doc-syntax-table">
        <thead>
          <tr>
            <th>Syntax</th>
            <th>Where it works</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><VarToken>$name</VarToken></td>
            <td>combine, derivation, assembler</td>
            <td>Reads the named variable from the Context and inserts its value.</td>
          </tr>
          <tr>
            <td><VarToken kind="ref">@{8hexchars}</VarToken></td>
            <td>wildcard options only</td>
            <td>
              Nested wildcard reference — resolves to the picked value of the target wildcard.
              Optionally followed by <VarToken kind="inline">#displayname</VarToken> (a human
              label matched on uuid, display only) and/or <VarToken kind="inline">:subcat</VarToken>
              (subcategory filter; <code>null</code> options are included unless
              <code>null</code> appears explicitly in the filter list).
            </td>
          </tr>
          <tr>
            <td><VarToken kind="inline">{a|b|c}</VarToken></td>
            <td>all text fields</td>
            <td>Randomly picks one of the alternatives — except in the Assembler, which has no seed and leaves it literal.</td>
          </tr>
          <tr>
            <td><VarToken kind="inline">{N$$sep$$a|b|c}</VarToken></td>
            <td>all text fields</td>
            <td>Picks N alternatives, joined by <em>sep</em> — also left literal in the Assembler.</td>
          </tr>
          <tr>
            <td><VarToken kind="inline">$$</VarToken></td>
            <td>all text fields</td>
            <td>Produces a literal <code>$</code> character.</td>
          </tr>
          <tr>
            <td><VarToken kind="inline">@@</VarToken></td>
            <td>all text fields</td>
            <td>Produces a literal <code>@</code> character.</td>
          </tr>
        </tbody>
      </table>
      <p style="margin-top: 10px; font-size: 12.5px; color: var(--wp-text-muted);">
        Variable names must match <code>^[A-Za-z_][A-Za-z0-9_]*$</code>, be at most 64 characters,
        and must not start with <code>__</code> (reserved for internal use).
        Ref UUIDs are exactly 8 lowercase hex characters.
      </p>
    </DocSection>

    <DocSection title="Where each syntax works">
      <p>
        Not every syntax token is active in every field. Here is a quick guide:
      </p>
      <ul>
        <li><VarToken>$var</VarToken> works in <b>combine</b>, <b>derivation</b>, and <b>assembler</b> templates.</li>
        <li><VarToken kind="ref">@{uuid}</VarToken> works in <b>wildcard option text</b> only — it lets one wildcard pull in the result of another.</li>
        <li><VarToken kind="inline">{a|b|c}</VarToken> and multi-pick forms resolve everywhere text is <em>rolled</em> — wildcard options, fixed values, combine, derivation. The <b>Assembler</b> has no seed, so it leaves them literal; roll the value upstream and reference its <VarToken>$var</VarToken>.</li>
      </ul>
      <DocCallout variant="warn">
        Wildcards and fixed values are <b>producers</b> — their option text doesn't read
        <VarToken>$var</VarToken> at all (only combine, derivation, and assembler templates do). So a
        wildcard can't pull in a value another module set, no matter the order. To build a value from
        earlier picks, add a <b>combine</b> or <b>derivation</b> after the producers — those surfaces
        do read <VarToken>$var</VarToken>.
      </DocCallout>
    </DocSection>

    <DocSection title="The flow">
      <DocFigure caption="Modules produce $vars inside a Context; the Assembler fills the template.">
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
</style>
