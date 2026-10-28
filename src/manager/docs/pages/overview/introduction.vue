<script setup lang="ts">
import Kbd from "@/components/shared/Kbd.vue";
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocFigure from "../../../components/docs/DocFigure.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import PipelineDiagram from "../../../components/docs/PipelineDiagram.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import VarToken from "../../../components/docs/VarToken.vue";
import StarterButton from "../../../components/docs/StarterButton.vue";
</script>

<template>
  <DocPage
    group="Overview"
    title="Introduction"
    icon="pi pi-compass"
    tone="neutral"
    blurb="Wildcard Pipeline builds a different prompt every run from lists and rules you set up once."
  >
    <div class="wp-doc-starter-cta">
      <div class="wp-doc-starter-cta__body">
        <span class="wp-doc-starter-cta__eyebrow"><i class="pi pi-bolt" aria-hidden="true" /> New here?</span>
        <h2 class="wp-doc-starter-cta__title">Build a runnable starter set in one click</h2>
        <p class="wp-doc-starter-cta__sub">
          Makes a small working example: two wildcards, a fixed value, a combine, a derivation and a
          constraint in one bundle, plus a template. Add it to a WP Context, generate, then open any
          piece to see how it's built.
        </p>
      </div>
      <StarterButton slot="bundle" />
    </div>

    <DocSection title="What does it do?">
      <p>
        Each time you press Generate, Wildcard Pipeline picks from your lists, follows your rules
        and fills in your prompt. You get a different prompt every run without typing.
      </p>
      <p>
        For example: a wildcard called "subject" holds <em>a cat</em>, <em>a dog</em> and <em>a
        fox</em>. Your template says <VarToken>A photo of $subject</VarToken>. Each run picks one
        animal and writes the prompt.
      </p>
    </DocSection>

    <DocSection title="How the pieces fit together">
      <p>
        You wire three nodes in ComfyUI:
      </p>
      <ul>
        <li>
          <b>WP Context</b> holds your modules (wildcards, fixed values, combines and so on) and
          turns them into <VarToken>$variables</VarToken> every run.
        </li>
        <li>
          <b>WP Prompt Assembler</b> fills your template with those variables.
        </li>
        <li>
          <b>CLIP Text Encode</b>, the normal ComfyUI node, takes the prompt to your sampler.
        </li>
      </ul>
      <DocFigure figure="introduction-figure" caption="Modules run in the WP Context, which passes $variables to the Assembler, which passes the prompt to CLIP.">
        <PipelineDiagram />
      </DocFigure>
    </DocSection>

    <DocSection title="What are modules?">
      <p>
        Modules are the pieces you build in this manager. Each one sets or changes
        <VarToken>$variables</VarToken>:
      </p>
      <ul>
        <li><DocRef id="wildcard" />: a list of options; one is picked each run.</li>
        <li><DocRef id="fixed-values" />: text that stays the same.</li>
        <li><DocRef id="combine" />: builds one phrase from several variables.</li>
        <li><DocRef id="derivation" />: if/then rules that change variables based on what was picked.</li>
        <li><DocRef id="constraint" />: makes some options of a later wildcard likelier or rule them out, based on an earlier pick.</li>
      </ul>
      <DocCallout variant="tip">
        Make and edit modules here in the manager, then add them to a WP Context on the canvas.
      </DocCallout>
    </DocSection>

    <DocSection title="A finished graph">
      <DocImage
        src="images/docs/introduction-graph.png"
        ratio="16 / 7"
        caption="The whole pipeline: a WP Context holding the Starter set bundle, then WP Prompt Assembler, CLIP Text Encode and KSampler."
      />
    </DocSection>

    <DocSection title="Good to know">
      <DocCallout variant="tip">
        Try right-clicking. Most WP nodes, and the rows inside them, have a menu: save a row to
        the library, pull in a library change, duplicate, and more.
      </DocCallout>
      <p>
        Finding your way in these docs: <Kbd keys="/" size="sm" /> jumps to the search box, which
        searches the text of every page and opens a result at its section
        (<Kbd keys="Enter" size="sm" /> opens the first). On a wide window, <b>On this page</b> on
        the right lists a page's sections; hover a section title for a link to it. Click a
        screenshot to see it full size, and use <b>Previous</b> and <b>Next</b> at the foot of a
        page to read on.
      </p>
    </DocSection>

    <DocSection title="Where to next">
      <CrossLinks
        :links="[
          { id: 'quick-start', label: 'Quick start', icon: 'pi pi-play', tone: 'neutral' },
          { id: 'glossary', label: 'Glossary', icon: 'pi pi-book', tone: 'neutral' },
          { id: 'pack-structure', label: 'Recommended pack structure', icon: 'pi pi-th-large', tone: 'neutral' },
          { id: 'prompt-writing', label: 'Writing prompts for your model', icon: 'pi pi-pencil', tone: 'neutral' },
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
  background: color-mix(in oklab, var(--wp-accent-500) 6%, var(--wp-bg-1));
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
