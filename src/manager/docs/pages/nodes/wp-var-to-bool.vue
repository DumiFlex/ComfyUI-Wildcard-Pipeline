<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import PropTable from "../../../components/docs/PropTable.vue";
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
    blurb="Parse a boolean out of a $var from the PipelineContext and emit it as a native BOOLEAN."
  >
    <DocSection title="What it does">
      <p>
        Pick a variable name from the upstream Context, choose a 0-based match index and a
        fallback default. The node tokenizes the variable's value on whitespace, commas,
        semicolons, pipes, and slashes, then matches each token case-insensitively against
        truthy (<code>true yes on 1</code>) or falsy (<code>false no off 0</code>) sets.
        Tokens that match neither are <b>skipped</b> and do not consume an index slot —
        so <code>1.5</code> is invisible to the bool parser. The Nth matching token is
        emitted as a <code>BOOLEAN</code>.
      </p>
    </DocSection>

    <DocSection title="Inputs &amp; outputs">
      <PropTable
        :rows="[
          { name: 'context', type: 'PIPELINE_CONTEXT', required: true, desc: 'Upstream Context carrying the $var to read.' },
          { name: 'var_name', type: 'WP_VAR_PICKER', required: true, desc: 'Dropdown of upstream $vars.' },
          { name: 'index', type: 'INT', required: true, desc: '0-based index into the list of truthy/falsy token matches (non-matching tokens skipped). Default 0.' },
          { name: 'default', type: 'BOOLEAN', required: true, desc: 'Returned when the var is missing or has fewer than index+1 boolean tokens. Default false.' },
          { name: 'value (out)', type: 'BOOLEAN', required: true, desc: 'The parsed boolean, or default on miss.' },
        ]"
      />
    </DocSection>

    <DocSection title="Key behaviors">
      <ul>
        <li>
          <b>Cacheable (not_idempotent = false)</b> — pure function of its inputs.
        </li>
        <li>
          <b>Truthy tokens:</b> <code>true</code>, <code>yes</code>, <code>on</code>,
          <code>1</code>. <b>Falsy tokens:</b> <code>false</code>, <code>no</code>,
          <code>off</code>, <code>0</code>. Matching is case-insensitive.
        </li>
        <li>
          <b>Non-matching tokens skipped (no index consumed)</b> — tokens like <code>1.5</code>,
          <code>maybe</code>, or <code>hello</code> are invisible. Index counts only over
          tokens that matched truthy or falsy. This means a var like
          <VarToken>true maybe false</VarToken> has index 0 → <code>true</code>, index 1 →
          <code>false</code>.
        </li>
        <li>
          <b>Never raises</b> — missing var, empty string, no matching tokens, or out-of-range
          index all silently fall back to <code>default</code>.
        </li>
      </ul>
      <DocCallout variant="tip">
        Use a wildcard with options <code>on</code> / <code>off</code> and wire it through
        WP Var → Bool to make any ComfyUI boolean input (e.g. a sampler toggle) probabilistic.
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
