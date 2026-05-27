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
    title="WP Prompt Cleaner"
    icon="pi pi-ban"
    tone="node"
    node-id="WP_PromptCleaner"
    blurb="Rule-based cleanup of a prompt string — dedupe tags, strip orphan punctuation, filter a blocklist. No Context input needed."
  >
    <DocSection title="What it does">
      <p>
        Wire any STRING output (typically from a <b>WP Prompt Assembler</b>) into the prompt
        input. The cleaner applies a configurable rule set — whitespace normalization, tag
        deduplication, fuzzy matching, and an optional blocklist — and emits the cleaned
        string. It operates on the text alone; there is no PipelineContext input.
      </p>
    </DocSection>

    <DocSection title="Inputs &amp; outputs">
      <PropTable
        :rows="[
          { name: 'prompt', type: 'STRING (multiline)', required: true, desc: 'Input text to clean. Typically from WP Prompt Assembler or any STRING source.' },
          { name: 'cleaner', type: 'WP_CLEANER', required: true, desc: 'Cleaner widget — configures mode (tags / text), intensity preset, per-rule toggles, and blocklist entries.' },
          { name: 'prompt (out)', type: 'STRING', required: true, desc: 'The cleaned prompt string.' },
        ]"
      />
    </DocSection>

    <DocSection title="Key behaviors">
      <ul>
        <li>
          <b>not_idempotent = true</b> — re-runs on every queue execution. This ensures the
          run-stats counters in the widget always reflect the latest output.
        </li>
        <li>
          <b>Mode: tags vs text</b> — in <b>tags</b> mode the input is split on commas and
          each segment is treated as a tag (deduplication and fuzzy rules operate on whole
          tags). In <b>text</b> mode the input is treated as prose; tag-only rules are
          disabled.
        </li>
        <li>
          <b>Intensity presets</b> — <b>gentle</b> applies whitespace normalization only;
          <b>balanced</b> adds punctuation cleanup and tag deduplication; <b>aggressive</b>
          also enables fuzzy deduplication. A <b>CUSTOM</b> badge lights up when your per-rule
          toggles diverge from the active preset.
        </li>
        <li>
          <b>Blocklist</b> — two modes: <b>list</b> (comma/newline-separated words, matched as
          case-insensitive word-boundary substrings) and <b>regex</b> (one pattern per line,
          compiled with IGNORECASE; bad patterns are skipped and reported). In tags mode the
          entire tag containing the match is removed; in text mode only the matched word is
          removed and orphan punctuation cleaned up.
        </li>
      </ul>
      <DocCallout variant="tip">
        Hover any rule control for an inline tooltip. Run-stats next to each active rule show
        exactly what was dropped on the last execution.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
