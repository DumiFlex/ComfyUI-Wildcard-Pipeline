<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocDetails from "../../../components/docs/DocDetails.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const ports = [
  { term: "upstream (in)", desc: "Optional. Another WP Context, an Injector, Model Info or a Loop. This node starts with their variables and can add to them or replace them." },
  { term: "seed", desc: "Decides every random pick in this node. See Seeds & loops." },
  { term: "context (out)", desc: "The variables. Wire it into a WP Prompt Assembler, a WP Debug or another WP Context." },
];

const markers = [
  { term: "Coloured dot or label", desc: "Something to look at, such as MISSING VAR or a variable set twice. Blue is for your information, amber is worth a look. Hover for the message. Nothing here stops a run." },
  { term: "drift", desc: "The library entry changed after you added it. Right-click → Refresh from library to take the change. On a bundle it reads library updated; right-click the bundle → Reset to library snapshot." },
  { term: "missing", desc: "The entry isn't in your library (deleted, or the workflow came from someone else). The row still works from its own copy; right-click → Save to library to add it." },
  { term: "mod", desc: "You changed this row on the node, so it differs from the library." },
  { term: "held", desc: "Hold across run is on." },
  { term: "Lock / globe / bin", desc: "The row buttons: lock the pick, hide the variable from the prompt, remove the row. Set Row buttons to On hover (ComfyUI Settings or the Display Playground) to show them only when the pointer is on the row; a pressed lock or globe always shows." },
];
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
      <DocKeyList :items="ports" />
    </DocSection>

    <DocSection title="What the row markers mean">
      <DocKeyList :items="markers" />
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
      <DocCallout variant="tip">
        Wire a <b>WP Debug</b> to the output to see exactly what each module picked.
      </DocCallout>
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
