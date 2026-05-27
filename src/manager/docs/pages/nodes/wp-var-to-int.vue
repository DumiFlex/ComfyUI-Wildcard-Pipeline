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
    title="WP Var → Int"
    icon="pi pi-hashtag"
    tone="node"
    node-id="WP_VarToInt"
    blurb="Parse an integer out of a $var from the PipelineContext and emit it as a native INT."
  >
    <DocSection title="What it does">
      <p>
        Pick a variable name from the upstream Context, choose a 0-based match index and a
        fallback default, and the node scans the variable's string value for signed-integer
        substrings. The Nth match is emitted as an <code>INT</code>. If the variable is
        missing, has no integer matches, or the index is out of range, the node falls back to
        <code>default</code> — it never raises an error.
      </p>
    </DocSection>

    <DocSection title="Inputs &amp; outputs">
      <PropTable
        :rows="[
          { name: 'context', type: 'PIPELINE_CONTEXT', required: true, desc: 'Upstream Context carrying the $var to read.' },
          { name: 'var_name', type: 'WP_VAR_PICKER', required: true, desc: 'Dropdown of upstream $vars. Stored as the plain name (e.g. resolution).' },
          { name: 'index', type: 'INT', required: true, desc: '0-based index into the list of integer matches found in the var value. Default 0.' },
          { name: 'default', type: 'INT', required: true, desc: 'Returned when the var is missing or has fewer than index+1 integer matches. Default 0.' },
          { name: 'value (out)', type: 'INT', required: true, desc: 'The parsed integer, or default on miss.' },
        ]"
      />
    </DocSection>

    <DocSection title="Key behaviors">
      <ul>
        <li>
          <b>Cacheable (not_idempotent = false)</b> — pure function of its inputs; ComfyUI
          may skip re-execution when context + var_name + index + default are unchanged.
        </li>
        <li>
          <b>Parsing rule: Nth <code>-?\d+</code> match</b> — the var's string value is
          scanned for all substrings matching a signed integer pattern. Index selects the Nth
          match (0-based). Examples: <VarToken>1920x1080</VarToken> index 0 → 1920, index 1
          → 1080. <VarToken>hello</VarToken> any index → <code>default</code>.
        </li>
        <li>
          <b>Never raises</b> — missing var, empty string, no matches, out-of-range index all
          silently fall back to <code>default</code>.
        </li>
      </ul>
      <DocCallout variant="tip">
        To extract both width and height from a single <VarToken>$resolution</VarToken> var
        (e.g. <code>1920x1080</code>), place two WP Var → Int nodes reading the same var:
        one with index 0 (width) and one with index 1 (height).
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-var-to-float', label: 'WP Var → Float', icon: 'pi pi-hashtag', tone: 'node' },
          { id: 'wp-var-to-bool', label: 'WP Var → Bool', icon: 'pi pi-check-square', tone: 'node' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
