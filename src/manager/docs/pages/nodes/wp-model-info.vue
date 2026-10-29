<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocFlow from "../../../components/docs/DocFlow.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const vars = [
  { term: "$model_family", desc: "The architecture, read from the loaded model itself: sd15, sdxl, flux, sd3, chroma and so on. Needs the model input." },
  { term: "$model_variant", desc: "The fine-tune line, read from the checkpoint's file name by the variant rules: pony, illustrious, noobai, animagine, or empty when no rule matches." },
  { term: "$model_name", desc: "The checkpoint's file name without folders or extension, e.g. ponyDiffusionV6XL." },
];

const caveats = [
  { term: "Flux.1 and Flux.2", desc: "Both read as flux." },
  { term: "Anima", desc: "Probably reads as cosmos." },
  { term: "Z-Image", desc: "Probably reads as lumina2." },
  { term: "Models with no entry", desc: "Krea 2, Kolors and others read as their class name, in lower case with underscores." },
  { term: "Merges", desc: "A file name without \"noob\", \"pony\" or \"illustrious\" in it gets no variant." },
];

const ports = [
  { term: "upstream (in)", desc: "An existing Context to extend. Only nodes after Model Info see its variables, so it usually goes first." },
  { term: "model (in)", desc: "The MODEL from your checkpoint loader. Gives the family, and the node follows the wire back to the loader for the file name, stepping over LoRA loaders and other model patches." },
  { term: "family, variant, name (in)", desc: "Optional text from another node, such as a switch that names the model you're testing. A wired value beats the pin and detection (an empty one is ignored); a wired name goes through the variant rules like the loader's. The row shows wired, and its value after a run. Each input's dot sits beside its row, like a built-in widget's, and shows when you hover the row or wire it." },
  { term: "Detected", desc: "The three values and where each comes from. Variant and name update as soon as you change the loader's checkpoint; the family shows after the first run." },
  { term: "Globe", desc: "Whether the variable can print. All three start hidden: rules and constraints read them, but the Assembler leaves them out. Click the globe to print one." },
  { term: "Pin", desc: "Use your own value for a row instead of the detected one: a file name when no model is wired, or a variant to try your Pony rules without switching checkpoint. Click it again to go back to detection." },
  { term: "Variant rules", desc: "Rows of variant and pattern. The first pattern found in the file name sets $model_variant, and its row lights up. Capitals don't matter; | separates alternatives (pony|pdxl). A broken row is outlined in red and skipped. Reset brings back the built-in rules." },
  { term: "context (out)", desc: "The upstream Context plus the three variables." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Model Info"
    icon="pi pi-microchip"
    tone="node"
    node-id="WP_ModelInfo"
    blurb="Name the loaded checkpoint so derivations and constraints can branch on it: Pony gets these LoRAs and tags, Illustrious gets those."
  >
    <DocSection title="What it's for">
      <p>
        One prompt setup rarely suits every checkpoint. Pony wants its score tags, Illustrious
        wants different LoRAs, Flux reads plain sentences. <b>WP Model Info</b> looks at the
        model you loaded and writes what it found into the Context, so the rest of the pipeline
        can react to it.
      </p>
      <DocKeyList :items="vars" />
      <p>
        Pony and Illustrious are both SDXL underneath, so <VarToken>$model_family</VarToken> reads
        sdxl for both. <VarToken>$model_variant</VarToken> tells them apart, and it can only come
        from the file name.
      </p>
      <p>Some models read in ways you might not expect:</p>
      <DocKeyList :items="caveats" />
      <p>
        Check once what the node reads for your checkpoint, then pin the variant or add a rule for
        its file name. Notes per model are on <DocRef id="prompt-writing" />.
      </p>
      <DocUseWhen
        :good="[
          'One pack that writes different quality tags, LoRAs or styles per checkpoint',
        ]"
        :better="[
          'A workflow that only ever runs one model: a fixed value is simpler',
        ]"
      />
    </DocSection>

    <DocSection title="Where it goes">
      <DocFlow figure="wp-model-info-flow"
        :stages="[
          { icon: 'pi pi-database', name: 'Load Checkpoint', sub: 'MODEL', tone: 'neutral' },
          { icon: 'pi pi-microchip', name: 'WP Model Info', sub: '$model_variant', tone: 'node' },
          { icon: 'pi pi-sitemap', name: 'WP Context', sub: 'rules branch on it', tone: 'node' },
        ]"
        :arrows="['MODEL', 'context']"
        caption="Model Info heads the chain, so every Context after it can read the model variables."
      />
      <DocCallout variant="warn">
        If a node that loads LoRAs from the prompt sits on the model, wire Model Info to the
        MODEL from <b>before</b> that node. Otherwise the prompt needs the model and the model
        needs the prompt, and ComfyUI refuses to run the loop.
      </DocCallout>
      <DocImage
        src="images/docs/wp-model-info.png"
        ratio="16 / 7"
        caption="Load Checkpoint → WP Model Info → WP Context → Assembler. The family is pinned to sdxl, the variant is read from the file name, and the template prints both."
      />
    </DocSection>

    <DocSection title="Inputs, outputs and controls">
      <DocKeyList :items="ports" />
    </DocSection>

    <DocSection title="LoRAs per model">
      <p>
        In the derivation editor, <b>LoRA by model</b> adds a ready-made rule: if
        <VarToken>$model_variant</VarToken> is pony, set <VarToken>$loras</VarToken> to a Pony LoRA tag;
        if illustrious, an Illustrious one; otherwise leave it empty. Swap the placeholder LoRA
        names for yours, add branches for other variants, and put <VarToken>$loras</VarToken> in
        your Assembler template. The same pattern works for quality tags, negatives or anything
        else a derivation can write.
      </p>
    </DocSection>

    <DocSection title="Constraints from the model">
      <p>
        Constraints react to a wildcard's pick, not to a variable, so the model reaches them
        through a wildcard. Make a wildcard (say <b>Model</b>) with options
        <VarToken>pony</VarToken> and <VarToken>illustrious</VarToken>, tag them, add it to your
        Context, and in its node settings set <b>Match variable</b> to
        <VarToken>model_variant</VarToken>. Instead of rolling, it picks the option whose text equals
        the detected variant, and any constraint can use it as its source, for example
        “if Model is pony, exclude photo styles”.
      </p>
      <DocCallout variant="tip">
        Mark one option of that wildcard as the fallback (for example “other”), so checkpoints
        your rules don't recognise still get a predictable pick. Without a fallback the wildcard
        rolls as usual and WP Debug notes that nothing matched.
      </DocCallout>
    </DocSection>

    <DocSection title="Good to know">
      <DocCallout variant="tip">
        The canvas previews <VarToken>$model_variant</VarToken> and
        <VarToken>$model_name</VarToken> from the loader's file name straight away.
        <VarToken>$model_family</VarToken> needs the loaded model, so it previews as a placeholder
        until the first run (or pin it).
      </DocCallout>
      <DocCallout variant="tip">
        Model Info lives in the workflow, not your library, so packs that branch on
        <VarToken>$model_variant</VarToken> work on any version that has the node.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
          { id: 'derivation', label: 'Derivation', icon: 'pi pi-arrow-right-arrow-left', tone: 'derivation' },
          { id: 'constraint', label: 'Constraint', icon: 'pi pi-filter', tone: 'constraint' },
          { id: 'wp-context-injector', label: 'WP Context Injector', icon: 'pi pi-bolt', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
