<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocFigure from "../../../components/docs/DocFigure.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import PipelineDiagram from "../../../components/docs/PipelineDiagram.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
import StarterButton from "../../../components/docs/StarterButton.vue";
</script>

<template>
  <DocPage
    group="Overview"
    title="Introduction"
    icon="pi pi-compass"
    tone="neutral"
    blurb="Wildcard Pipeline is a ComfyUI extension that builds varied, structured prompts from a set of named modules — no manual editing between generations."
  >
    <div class="wp-doc-starter-cta">
      <div class="wp-doc-starter-cta__body">
        <span class="wp-doc-starter-cta__eyebrow"><i class="pi pi-bolt" aria-hidden="true" /> New here?</span>
        <h2 class="wp-doc-starter-cta__title">Build a runnable starter set in one click</h2>
        <p class="wp-doc-starter-cta__sub">
          Creates a complete, working example — two wildcards, a fixed value, a combine, a
          derivation, and a constraint, packaged into a bundle (plus a matching prompt template).
          Drop it into a WP Context and generate, then open any piece to see how it's built.
        </p>
      </div>
      <StarterButton slot="bundle" />
    </div>

    <DocSection title="What does it do?">
      <p>
        Each time you press Generate, Wildcard Pipeline randomly picks from your
        lists, combines the results, and drops them into a prompt template. You
        get a different, meaningful prompt every run without touching the text.
      </p>
      <p>
        A simple example: you have a wildcard called "subject" with options
        <em>a cat</em>, <em>a dog</em>, and <em>a fox</em>. Your template reads
        <VarToken>A photo of $subject</VarToken>. Each generation picks one
        animal and assembles the final prompt for you.
      </p>
    </DocSection>

    <DocSection title="How the pieces fit together">
      <p>
        There are three nodes you connect in ComfyUI:
      </p>
      <ul>
        <li>
          <b>WP Context</b> — holds your modules (wildcards, fixed values,
          combines, etc.) and resolves them into a map of
          <VarToken>$variables</VarToken> on every run.
        </li>
        <li>
          <b>WP Prompt Assembler</b> — takes the variable map and fills your
          template string, producing a ready-to-use prompt.
        </li>
        <li>
          <b>CLIP Text Encode</b> (standard ComfyUI node) — receives the
          assembled prompt and feeds it into your sampler.
        </li>
      </ul>
      <DocFigure caption="Modules resolve inside WP Context → named $variables → WP Prompt Assembler → CLIP.">
        <PipelineDiagram />
      </DocFigure>
    </DocSection>

    <DocSection title="What are modules?">
      <p>
        Modules are the building blocks you author in this manager. Each module
        produces (or shapes) one <VarToken>$variable</VarToken> in the context:
      </p>
      <ul>
        <li><b>Wildcard</b> — a list of options; one is picked at random each run.</li>
        <li><b>Fixed Values</b> — always outputs the same value.</li>
        <li><b>Combine</b> — joins several variables into one string.</li>
        <li><b>Derivation</b> — transforms an existing variable into a new one.</li>
        <li><b>Constraint</b> — forces a wildcard to pick a specific option when another variable has a certain value.</li>
      </ul>
      <DocCallout variant="tip">
        You create and edit modules here in the manager. You then add them to a
        WP Context node on the ComfyUI canvas.
      </DocCallout>
    </DocSection>

    <DocSection title="A finished graph">
      <DocImage
        src="images/docs/introduction-graph.png"
        ratio="16 / 6"
        caption="A minimal finished graph: WP Context (with a subject wildcard) → WP Prompt Assembler → CLIP Text Encode → KSampler."
      />
    </DocSection>

    <DocSection title="Good to know">
      <DocCallout variant="tip">
        Right-click is your friend. Most WP nodes — and the rows inside their widgets — carry a
        context menu: push a module to the library, sync a drifted one, bypass, duplicate, and
        more. If something looks interactive, try right-clicking it too; a lot of the handy stuff
        is tucked in there.
      </DocCallout>
    </DocSection>

    <DocSection title="Where to next">
      <CrossLinks
        :links="[
          { id: 'quick-start', label: 'Quick start', icon: 'pi pi-play', tone: 'neutral' },
          { id: 'glossary', label: 'Glossary', icon: 'pi pi-book', tone: 'neutral' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>

<style scoped>
/* Hero CTA — the new-user entry point to the starter-set feature. Sits at the
 * top of the docs landing so the "Build starter bundle" action is visible
 * without scrolling to a module page's bottom. */
.wp-doc-starter-cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  padding: 18px 20px;
  border-radius: var(--wp-radius-lg, 12px);
  border: 1px solid color-mix(in oklab, var(--wp-accent-500) 38%, var(--wp-border));
  background:
    linear-gradient(120deg, color-mix(in oklab, var(--wp-accent-500) 12%, transparent), transparent 62%),
    var(--wp-bg-1);
}
.wp-doc-starter-cta__body { min-width: 0; flex: 1 1 320px; }
.wp-doc-starter-cta__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--wp-accent-text, var(--wp-accent-500));
}
.wp-doc-starter-cta__title {
  margin: 6px 0 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--wp-text);
}
.wp-doc-starter-cta__sub {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--wp-text-muted);
}
</style>
