<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocFigure from "../../../components/docs/DocFigure.vue";
import PipelineDiagram from "../../../components/docs/PipelineDiagram.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="Overview"
    title="Introduction"
    icon="pi pi-compass"
    tone="neutral"
    blurb="Wildcard Pipeline turns a stack of modules into a resolved $variable map, then fills your prompt template from it."
  >
    <DocSection title="The mental model">
      <p>
        You build a <b>Context</b> from <b>modules</b> — wildcards, fixed values, combines,
        derivations, constraints. The Context rolls each module with a seed and produces a map of
        named <VarToken>$variables</VarToken>. A <b>WP Prompt Assembler</b> fills a template like
        <VarToken>A $style portrait of $subject</VarToken> from that map, and the resulting string
        drives CLIP (or any text input).
      </p>
    </DocSection>

    <DocSection title="How it fits together">
      <DocFigure caption="Modules roll inside a Context → resolved $vars → Assembler → CLIP.">
        <PipelineDiagram />
      </DocFigure>
    </DocSection>

    <DocSection title="Where to next">
      <CrossLinks
        :links="[
          { id: 'quick-start', label: 'Quick start', icon: 'pi pi-play', tone: 'neutral' },
          { id: 'variable-pipeline', label: 'The $variable pipeline', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
