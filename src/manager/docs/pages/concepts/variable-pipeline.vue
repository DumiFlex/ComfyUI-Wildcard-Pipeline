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
            <td>Reads the named variable from the Context and inserts its value. For a multi-pick
              variable, bare <VarToken>$name</VarToken> joins the whole list with its separator.</td>
          </tr>
          <tr>
            <td><VarToken>$name.K</VarToken></td>
            <td>combine, derivation, assembler</td>
            <td>Indexes a single item out of a multi-pick result — <code>K</code> is 0-based, so
              <VarToken>$colors.0</VarToken> is the first pick. Out-of-range indices resolve to empty.</td>
          </tr>
          <tr>
            <td><VarToken kind="ref">@{8hexchars}</VarToken></td>
            <td>wildcard options, derivation actions</td>
            <td>
              Nested module reference — resolves to the picked value of the target wildcard.
              Segments are optional and combinable: <VarToken kind="inline">#name</VarToken>
              caches a display name (shown only if the row is missing),
              <VarToken kind="inline">:filter</VarToken> narrows a referenced wildcard's pool by a
              sub-category boolean expression (e.g. <code>warm or cool</code>), and
              <VarToken kind="inline">!null</VarToken> drops the null option. Full form:
              <VarToken kind="ref">@{abcd1234#Mood:calm or intense!null}</VarToken>.
            </td>
          </tr>
          <tr>
            <td><VarToken kind="inline">{a|b|c}</VarToken></td>
            <td>all text fields</td>
            <td>Picks one alternative at render time. Weight an arm with <code>N::value</code>
              (e.g. <VarToken kind="inline">{3::cat|dog}</VarToken> makes cat 3× as likely). The
              Assembler has no seed, so it leaves picks literal.</td>
          </tr>
          <tr>
            <td><VarToken kind="inline">{N$$sep$$a|b|c}</VarToken></td>
            <td>all text fields</td>
            <td>Multi-pick: picks <em>N</em> items joined by <em>sep</em>.
              <VarToken kind="inline">{N-M$$sep$$…}</VarToken> picks a random count in the
              <em>N–M</em> range. Default is UNIQUE (no repeats); add <code>~</code>
              (<VarToken kind="inline">{N~$$…}</VarToken> / <VarToken kind="inline">{N-M~$$…}</VarToken>)
              for INDEPENDENT picks with replacement, which may repeat.</td>
          </tr>
          <tr>
            <td><VarToken kind="inline">$$</VarToken> · <VarToken kind="inline">@@</VarToken> · <VarToken kind="inline">&#123;&#123;</VarToken></td>
            <td>all text fields</td>
            <td>Escapes — produce a literal <code>$</code>, <code>@</code>, or <code>&#123;</code>
              instead of starting a token.</td>
          </tr>
        </tbody>
      </table>
      <DocCallout variant="tip">
        An inline pick's arms are resolved <b>recursively</b>, so an arm can itself contain
        <VarToken>$vars</VarToken>, <VarToken kind="ref">@{}</VarToken> refs, and further
        <VarToken kind="inline">{…}</VarToken> picks — for example
        <VarToken kind="inline">{a @{abcd1234} cat|{2$$, $$red|blue|green} sky}</VarToken>. What
        each nested token resolves to still depends on the surface it sits on — see the gate below.
      </DocCallout>
      <p style="margin-top: 10px; font-size: 12.5px; color: var(--wp-text-muted);">
        Variable names must match <code>^[A-Za-z_][A-Za-z0-9_]*$</code>, be at most 64 characters,
        and must not start with <code>__</code> (reserved for internal use).
        Ref UUIDs are exactly 8 lowercase hex characters.
      </p>
    </DocSection>

    <DocSection title="The per-surface gate">
      <p>
        Not every token resolves on every surface — each module resolves only what makes sense for
        it; anything else stays literal text.
      </p>
      <table class="wp-doc-syntax-table wp-doc-gate-table">
        <thead>
          <tr>
            <th>Surface</th>
            <th><VarToken>$var</VarToken> read</th>
            <th><VarToken kind="ref">@{uuid}</VarToken> ref</th>
            <th><VarToken kind="inline">{a|b}</VarToken> pick</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Wildcard option value</td>
            <td>—</td>
            <td>✓</td>
            <td>✓</td>
          </tr>
          <tr>
            <td>Combine template</td>
            <td>✓</td>
            <td>literal</td>
            <td>✓</td>
          </tr>
          <tr>
            <td>Derivation action value</td>
            <td>✓</td>
            <td>✓</td>
            <td>✓</td>
          </tr>
          <tr>
            <td>Derivation condition value</td>
            <td>✓</td>
            <td>—</td>
            <td>—</td>
          </tr>
          <tr>
            <td>Fixed Values value</td>
            <td>—</td>
            <td>—</td>
            <td>✓</td>
          </tr>
          <tr>
            <td>Prompt Assembler template</td>
            <td>✓</td>
            <td>literal</td>
            <td>literal</td>
          </tr>
        </tbody>
      </table>
      <DocCallout variant="warn">
        Wildcards and fixed values are <b>producers</b> — their option text doesn't read
        <VarToken>$var</VarToken> at all. So a wildcard can't pull in a value another module set,
        no matter the order. To build a value from earlier picks, add a <b>combine</b> or
        <b>derivation</b> after the producers — those surfaces do read <VarToken>$var</VarToken>.
      </DocCallout>
      <DocCallout variant="tip">
        The Assembler is <b>seedless</b>: any leftover picks or refs in the final template render
        verbatim, so roll the value upstream and reference its <VarToken>$var</VarToken>.
        Derivation <b>action</b> values now resolve <VarToken kind="ref">@{}</VarToken> refs too —
        a rule can inject a nested wildcard's pick — while derivation <b>conditions</b> compare
        plain <VarToken>$var</VarToken> values only.
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

/* Gate table: first column is the surface label (left), the three token
   columns are short markers (✓ / literal / —) that read best centred. */
.wp-doc-gate-table th:not(:first-child),
.wp-doc-gate-table td:not(:first-child) { text-align: center; }
.wp-doc-gate-table td:first-child { color: var(--wp-text); font-weight: 500; }
</style>
