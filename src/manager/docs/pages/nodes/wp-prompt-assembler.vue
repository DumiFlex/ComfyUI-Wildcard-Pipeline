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
    title="WP Prompt Assembler"
    icon="pi pi-align-left"
    tone="node"
    node-id="WP_PromptAssembler"
    blurb="Fill $var placeholders in a template string from the upstream Context and emit the resolved prompt STRING."
  >
    <DocSection title="What it does">
      <p>
        Write a template like <VarToken>A $style portrait of $subject, $lighting</VarToken>
        and the Assembler substitutes every <VarToken>$variable</VarToken> from the upstream
        Context's resolved map. The result is a plain STRING you wire directly into a CLIP
        Text Encode, a WP Prompt Cleaner, or any other text input. Internal variables are
        stripped before resolution — they never appear in the rendered prompt even though they
        stay available to Combine and Derivation modules upstream.
      </p>
    </DocSection>

    <DocSection title="Inputs &amp; outputs">
      <PropTable
        :rows="[
          { name: 'context', type: 'PIPELINE_CONTEXT', required: true, desc: 'Resolved $variable map from any WP Context chain.' },
          { name: 'template', type: 'STRING (multiline)', required: true, desc: 'Prompt template. Use $varname to reference bound values. Placeholder: A $style portrait of $subject.' },
          { name: 'prompt (out)', type: 'STRING', required: true, desc: 'The fully resolved prompt string ready for CLIP or other text consumers.' },
        ]"
      />
    </DocSection>

    <DocSection title="Key behaviors">
      <ul>
        <li>
          <b>Cacheable (not_idempotent = false)</b> — given the same context map and template,
          the output is deterministic. ComfyUI may skip re-execution when inputs are unchanged.
        </li>
        <li>
          <b>Internal variables stripped before resolve</b> — any variable flagged internal
          (by a module's <code>internal</code> toggle or a loop's internal flag) is removed
          from the render context before substitution. Its <VarToken>$name</VarToken> in the
          template resolves as empty (shown with an amber underline in the canvas preview).
        </li>
        <li>
          <b>Missing variable → empty + amber underline</b> — if a <VarToken>$var</VarToken>
          appears in the template but has no binding in the Context, it resolves to an empty
          string. The canvas preview widget highlights it with an amber wavy underline so you
          can spot the gap before running.
        </li>
        <li>
          <b>Full surface syntax supported</b> — resolve surface <code>assembler</code>
          supports <VarToken>$var</VarToken> substitution, <VarToken kind="ref">@{uuid}</VarToken>
          nested ref resolution, <VarToken kind="inline">{a|b|c}</VarToken> uniform random
          pick, and <code>$$</code> → literal <code>$</code>.
        </li>
        <li>
          <b>Save / Load template buttons</b> — toolbar buttons let you save the current
          template to the Templates library or load a saved one. The assembler tracks which
          library entry it last loaded so the next Save defaults to updating that entry.
          Manage templates in the SPA <b>Templates</b> tab.
        </li>
      </ul>
      <DocCallout variant="tip">
        The <b>Variables</b> strip below the template lists every upstream binding — click any
        chip to insert <code>$name</code> at the cursor position.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'variable-pipeline', label: 'The $variable pipeline', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'wp-prompt-cleaner', label: 'WP Prompt Cleaner', icon: 'pi pi-ban', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
