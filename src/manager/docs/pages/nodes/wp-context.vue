<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import Banner from "@/kit/Banner.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocFields from "../../../components/docs/DocFields.vue";
import DocDetails from "../../../components/docs/DocDetails.vue";
import DocRef from "../../../components/docs/DocRef.vue";
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
    blurb="The heart of the pipeline. Stack modules from your library, roll them with a seed, and send the $variables on to an Assembler."
  >
    <DocSection title="What it does">
      <p>
        Add a wildcard and the node rolls it into <VarToken>$subject</VarToken>; add a fixed value
        and you get <VarToken>$style</VarToken>. On every Generate the node runs its modules from
        top to bottom and passes the finished list of variables to the next node.
      </p>
      <DocUseWhen
        :good="[
          'One per pack or per character',
          'A second, chained Context that adds to or replaces the first',
        ]"
        :better="[
          'Text typed onto the canvas or an LLM caption: use WP Context Injector',
        ]"
      />
      <DocImage
        src="images/docs/wp-context.png"
        ratio="16 / 7"
        caption="A WP Context with a few modules, wired into the next node."
      />
    </DocSection>

    <DocSection title="Use it">
      <ol>
        <li>Click <b>Add module</b> and pick from your library, or <b>Add Bundle</b> for a saved
          group.</li>
        <li>Mind the order: modules run top to bottom. A combine that reads
          <VarToken>$mood</VarToken> goes below the wildcard that picks it, and a constraint goes
          between its two wildcards.</li>
        <li>Wire <code>context</code> into a <b>WP Prompt Assembler</b> and write a template such as
          <VarToken>a photo of $subject</VarToken>.</li>
      </ol>
      <p>
        Drag a row by its handle to reorder it or move it to another Context. Untick a row to switch
        it off. Right-click a row for Edit, Duplicate, Hold across run, Save to library and more.
      </p>
    </DocSection>

    <DocSection title="Inputs and outputs">
      <DocFields node="WP_Context" group="ports" />
    </DocSection>

    <DocSection title="What the row markers mean">
      <DocFields node="WP_Context" group="markers" />
    </DocSection>

    <DocSection title="Good to know">
      <ul>
        <li><b>Chaining:</b> a later Context can set the same variable again, and the later value
          wins. See <DocRef id="context-chaining" />.</li>
        <li><b>Keep a pick steady:</b> Lock pick / Lock seed keeps it for good, Hold across run for
          one Generate. See <DocRef id="seeds-and-loops" />.</li>
        <li><b>Duplicate</b> renames the copy's variable (<code>$hair</code> becomes
          <code>$hair_2</code>) so the copy rolls on its own.</li>
        <li><b>Rows are copies.</b> Editing a module in the library doesn't change the workflow until
          you Refresh the row, so a saved workflow keeps giving the same results.</li>
      </ul>
      <DocDetails title="Where @{} references look">
        <p>
          A reference such as <VarToken>@{color}</VarToken> looks for its wildcard among this node's
          rows first (even a switched-off row), then in the library of the machine that runs the
          workflow. Keep the wildcards a reference needs on the node and a workflow you share works
          on someone else's machine too. WP Debug shows where each pick came from.
        </p>
      </DocDetails>
      <Banner tone="info" note>
        Wire a <b>WP Debug</b> to the output to see exactly what each module picked.
      </Banner>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
          { id: 'wp-context-loop', label: 'WP Context Loop', icon: 'pi pi-replay', tone: 'node' },
          { id: 'iteration-overrides', label: 'Per-iteration overrides', icon: 'pi pi-images', tone: 'neutral' },
          { id: 'wp-context-injector', label: 'WP Context Injector', icon: 'pi pi-bolt', tone: 'node' },
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
          { id: 'constraint', label: 'Constraint', icon: 'pi pi-filter', tone: 'constraint' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
