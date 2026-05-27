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
    title="WP Var → Float"
    icon="pi pi-hashtag"
    tone="node"
    node-id="WP_VarToFloat"
    blurb="Parse a float out of a $var from the PipelineContext and emit it as a native FLOAT."
  >
    <DocSection title="What it does">
      <p>
        Pick a variable name from the upstream Context, choose a 0-based match index and a
        fallback default, and the node scans the variable's string value for decimal or
        scientific-notation numbers. The Nth match is emitted as a <code>FLOAT</code>. Plain
        integers match too (e.g. <code>1920</code> → <code>1920.0</code>). Missing var, no
        matches, or out-of-range index fall back to <code>default</code> without raising.
      </p>
    </DocSection>

    <DocSection title="Inputs &amp; outputs">
      <PropTable
        :rows="[
          { name: 'context', type: 'PIPELINE_CONTEXT', required: true, desc: 'Upstream Context carrying the $var to read.' },
          { name: 'var_name', type: 'WP_VAR_PICKER', required: true, desc: 'Dropdown of upstream $vars.' },
          { name: 'index', type: 'INT', required: true, desc: '0-based index into the list of float matches. Default 0.' },
          { name: 'default', type: 'FLOAT', required: true, desc: 'Returned when the var is missing or has fewer than index+1 float matches. Default 0.0.' },
          { name: 'value (out)', type: 'FLOAT', required: true, desc: 'The parsed float, or default on miss.' },
        ]"
      />
    </DocSection>

    <DocSection title="Key behaviors">
      <ul>
        <li>
          <b>Cacheable (not_idempotent = false)</b> — pure function of its inputs.
        </li>
        <li>
          <b>Parsing rule: Nth decimal/scientific match</b> — pattern
          <code>-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?</code>. Integers match too, so
          <VarToken>1920</VarToken> → <code>1920.0</code>. Floats like <VarToken>1.5e-3</VarToken>
          are captured as-is.
        </li>
        <li>
          <b>Never raises</b> — all miss conditions (missing var, empty string, no matches,
          out-of-range index) silently fall back to <code>default</code>.
        </li>
      </ul>
      <DocCallout variant="tip">
        Because integers match the float pattern, you can use WP Var → Float in place of
        WP Var → Int when you need a FLOAT output from a whole-number var value.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-var-to-int', label: 'WP Var → Int', icon: 'pi pi-hashtag', tone: 'node' },
          { id: 'wp-var-to-bool', label: 'WP Var → Bool', icon: 'pi pi-check-square', tone: 'node' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
