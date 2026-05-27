<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocFigure from "../../../components/docs/DocFigure.vue";
import PipelineDiagram from "../../../components/docs/PipelineDiagram.vue";
import PropTable from "../../../components/docs/PropTable.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Context"
    icon="pi pi-sitemap"
    tone="node"
    node-id="WP_Context"
    blurb="The heart of the pipeline. Holds an ordered stack of modules, rolls each one with a seed, and emits a Context of resolved $variables for everything downstream."
  >
    <DocSection title="What it does">
      <p>
        Drop modules into a Context and each contributes named values: a
        <VarToken>$subject</VarToken> from a wildcard, a <VarToken>$style</VarToken> from a fixed
        value, a <VarToken>$lighting</VarToken> from a combine. Chain Contexts to layer or override
        values — the last write wins. Feed the output into a <b>WP Prompt Assembler</b> to fill a
        template string, or pass it to a <b>WP Debug</b> node to inspect the resolved map.
      </p>
    </DocSection>

    <DocSection title="How it fits — the $variable pipeline">
      <DocFigure caption="Modules roll inside a Context → resolved $vars → Assembler → CLIP.">
        <PipelineDiagram />
      </DocFigure>
    </DocSection>

    <DocSection title="Inputs &amp; outputs">
      <PropTable
        :rows="[
          { name: 'upstream', type: 'PIPELINE_CONTEXT', required: false, desc: 'Upstream Context to chain onto. Its $vars flow through; same-named values are overridden by this node.' },
          { name: 'seed', type: 'INT', required: true, desc: 'Drives every roll in the module stack. Uses control_after_generate so it cycles automatically in the queue.' },
          { name: 'modules', type: 'WP_CONTEXT_MODULES', required: true, desc: 'The ordered module stack widget — add wildcards, fixed values, combines, derivations, constraints, or bundles.' },
          { name: 'context (out)', type: 'PIPELINE_CONTEXT', required: true, desc: 'Resolved $variable map emitted for downstream Assembler, Injector, Debug, or another Context.' },
        ]"
      />
    </DocSection>

    <DocSection title="Key behaviors">
      <ul>
        <li><b>not_idempotent</b> — re-rolls every queue execution, even if inputs are unchanged. This ensures seed cycling always produces a new result.</li>
        <li><b>Last write wins</b> — when chaining two Contexts that set the same <VarToken>$variable</VarToken>, the downstream Context overrides. Use <b>WP Context Injector</b> for a one-off override without restructuring the chain.</li>
        <li><b>Wildcard catalog</b> — the engine expands wildcard options against the live library database at execution time.</li>
      </ul>
      <DocCallout variant="tip">
        Lock a module's seed (set <b>locked_seed</b> in the module's instance overrides) to freeze
        that module's pick across WP Context Loop iterations while everything else varies.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
          { id: 'wp-context-loop', label: 'WP Context Loop', icon: 'pi pi-replay', tone: 'node' },
          { id: 'wp-context-injector', label: 'WP Context Injector', icon: 'pi pi-bolt', tone: 'node' },
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
          { id: 'constraint', label: 'Constraint', icon: 'pi pi-filter', tone: 'constraint' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
