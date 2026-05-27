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
        When a <b>WP Context</b> executes, it seeds an RNG from its <code>seed</code> input and
        runs its module stack top-to-bottom. Each module returns a set of
        <VarToken>name = value</VarToken> bindings which are written into the Context. The final
        Context is emitted on the <code>PIPELINE_CONTEXT</code> output and consumed downstream by
        Assemblers, other Contexts, or Debug nodes.
      </p>
    </DocSection>

    <DocSection title="Syntax reference">
      <p>The following constructs are recognized inside template strings and wildcard option text:</p>
      <table class="wp-doc-syntax-table">
        <thead>
          <tr>
            <th>Syntax</th>
            <th>Surface</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><VarToken>$name</VarToken></td>
            <td>combine, derivation, assembler</td>
            <td>Read the named variable from the Context.</td>
          </tr>
          <tr>
            <td><VarToken kind="ref">@{8hexchars}</VarToken></td>
            <td>wildcard options only</td>
            <td>
              Nested wildcard ref — resolves to the picked value of the target wildcard instance.
              Optionally followed by <VarToken kind="inline">#displayname</VarToken> (display only,
              matched on uuid) and/or <VarToken kind="inline">:subcat</VarToken> (subcategory filter
              with inverted-null: null options are included unless <code>null</code> is explicitly in
              the filter list).
            </td>
          </tr>
          <tr>
            <td><VarToken kind="inline">{a|b|c}</VarToken></td>
            <td>all text fields</td>
            <td>Uniform random pick from the alternatives.</td>
          </tr>
          <tr>
            <td><VarToken kind="inline">{N$$sep$$a|b|c}</VarToken></td>
            <td>all text fields</td>
            <td>Pick N alternatives, joined by <em>sep</em>.</td>
          </tr>
          <tr>
            <td><VarToken kind="inline">$$</VarToken></td>
            <td>all text fields</td>
            <td>Escaped literal <code>$</code>.</td>
          </tr>
          <tr>
            <td><VarToken kind="inline">@@</VarToken></td>
            <td>all text fields</td>
            <td>Escaped literal <code>@</code>.</td>
          </tr>
        </tbody>
      </table>
      <p style="margin-top: 10px; font-size: 12.5px; color: var(--wp-text-muted);">
        Variable names must match <code>^[A-Za-z_][A-Za-z0-9_]*$</code>, be at most 64 characters,
        and must not start with <code>__</code> (reserved for internal keys).
        Ref UUIDs are exactly 8 lowercase hex characters.
      </p>
    </DocSection>

    <DocSection title="Surface gating">
      <p>
        Not every construct is active in every context. Surfaces control what resolves where:
      </p>
      <ul>
        <li><VarToken>$var</VarToken> reads from the Context in <b>combine</b>, <b>derivation</b>, and <b>assembler</b> (template fill).</li>
        <li><VarToken kind="ref">@{uuid}</VarToken> resolves in <b>wildcard</b> option text only (nested pick).</li>
        <li><VarToken kind="inline">{a|b|c}</VarToken> and multi-pick forms are active everywhere text is resolved.</li>
      </ul>
      <DocCallout variant="warn">
        Producer modules (wildcard, fixed values) run before the Context has a full map, so they
        cannot read <VarToken>$var</VarToken> references from the same Context. Use a
        <b>combine</b> or <b>derivation</b> module placed after the producers to compose values.
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
