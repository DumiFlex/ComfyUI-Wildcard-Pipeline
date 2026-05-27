<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import PropTable from "../../../components/docs/PropTable.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Debug"
    icon="pi pi-eye"
    tone="node"
    node-id="WP_Debug"
    blurb="Terminal inspection node — snapshot every $var, trace module history, see wildcard picks, and review runtime warnings."
  >
    <DocSection title="What it does">
      <p>
        Drop a <b>WP Debug</b> node anywhere in the chain and wire any
        <code>PIPELINE_CONTEXT</code> output into it. After each run the built-in
        <b>DebugViewer</b> widget populates with a tabbed view of everything that flowed
        through that point in the pipeline. It produces no outputs — it is purely a
        read-only observation node.
      </p>
    </DocSection>

    <DocSection title="Inputs &amp; outputs">
      <PropTable
        :rows="[
          { name: 'context', type: 'PIPELINE_CONTEXT', required: true, desc: 'Any point in the Context chain to inspect.' },
          { name: 'viewer', type: 'WP_DEBUG_VIEWER', required: true, desc: 'The debug viewer widget (socketless). Resize by dragging the bottom-right corner.' },
        ]"
      />
    </DocSection>

    <DocSection title="Key behaviors">
      <ul>
        <li>
          <b>not_idempotent = true, is_output_node = true</b> — re-runs on every queue
          execution (never cached) and is treated as a terminal output node by ComfyUI so it
          always executes even when nothing downstream depends on it.
        </li>
        <li>
          <b>Four viewer tabs:</b>
          <ul>
            <li><b>Snapshot</b> — every bound <code>$variable</code> and its resolved value.
            Engine-internal keys (<code>__wp_*</code>) are filtered out by default.</li>
            <li><b>Trace</b> — per-module resolution history showing each module's writes.</li>
            <li><b>Picks</b> — what each wildcard rolled on this execution.</li>
            <li><b>Warnings</b> — runtime warning objects (unknown vars, never-fired
            constraints, invalid bindings, etc.).</li>
          </ul>
        </li>
        <li>
          <b>Flattens the typed payload</b> — the engine merges <code>context</code>,
          <code>debug</code>, and <code>internals</code> into one flat dict with
          <code>__</code>-prefixed meta keys; the viewer tabs read each category explicitly.
        </li>
      </ul>
      <DocCallout variant="tip">
        Use the filter box at the top of each tab to narrow on a variable name or warning type.
        Always re-runs so seed-driven values refresh every queue.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'conflicts-and-warnings', label: 'Conflicts &amp; warnings', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'warning-types', label: 'Warning &amp; conflict types', icon: 'pi pi-list', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
