<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import DocRef from "../../../components/docs/DocRef.vue";

const ports = [
  { term: "prompt (in)", desc: "The text to clean, usually from a WP Prompt Assembler. Any text works." },
  { term: "cleaner widget", desc: "Pick a mode and a preset, switch single rules on or off, and edit the blocklist. After a run it shows how many fixes each rule made." },
  { term: "negative (in)", desc: "Optional. A negative to clean too: type it or wire in the Assembler's negative. Left empty, the negative output is empty." },
  { term: "prompt (out)", desc: "The cleaned prompt, for CLIP Text Encode." },
  { term: "negative (out)", desc: "The cleaned negative, using the negative column's rules. Wire it into your negative CLIP Text Encode." },
];

const presets = [
  { term: "Gentle", desc: "Only tidies spaces: removes doubled spaces and spaces at the ends. The safest choice." },
  { term: "Balanced", desc: "Also removes empty brackets, tidies LoRA tags and stray punctuation, and drops exact duplicate tags. None of these change what the prompt means. A good default." },
  { term: "Aggressive", desc: "Also merges stacked weights and drops near-duplicates (\"bad hand\" and \"bad hands\"). Now and then it removes something you meant to keep." },
  { term: "Custom", desc: "Shown when you've switched single rules away from the preset." },
];

const syntaxRules = [
  { term: "Empty groups", desc: "Removes brackets with nothing inside: (), [], ( , ), (:1.2), and groups left empty once those go. red (), dress becomes red, dress. The usual cause is a weighted reference that printed nothing: (@{hat}:1.2) becomes (:1.2). On from Balanced." },
  { term: "Merge weights", desc: "Folds stacked weights into one group by multiplying them, as ComfyUI does (a bare ( ) counts as 1.1): ((a:1.1):1.2) becomes (a:1.32), (((a))) becomes (a:1.33), and (a:1.0) becomes plain a. Only merges when the inner group is everything inside the outer one, rounds to 2 decimals, and never touches [ ]. On in Aggressive." },
  { term: "LoRA spacing", desc: "Tidies <lora:…> tags (and lyco, locon, hypernet, <embedding:…>): < lora : x : 0.8 > becomes <lora:x:0.8>, and girl<lora:x:1> becomes girl <lora:x:1>. Spaces inside a file name stay. On from Balanced." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Prompt Cleaner"
    icon="pi pi-ban"
    tone="node"
    node-id="WP_PromptCleaner"
    blurb="Tidy a prompt before the sampler: drop duplicates and stray commas, fix brackets and LoRA tags, and block words you never want."
  >
    <DocSection title="What it's for">
      <p>
        Wire a prompt, usually from a <b>WP Prompt Assembler</b>, into the Cleaner. It tidies
        spaces, empty brackets, stacked weights and LoRA tags, drops duplicate tags, and removes
        words on your blocklist. The clean text goes on to CLIP Text Encode. It needs no Context.
      </p>
      <DocUseWhen
        :good="[
          'Removing duplicates and near-duplicates after the Assembler',
          'Merging weights, spacing LoRA tags, blocking words',
        ]"
        :better="[
          'Fixing a pack: if it often removes something, fix the option that wrote it',
        ]"
      />
      <DocCallout variant="tip">
        Never blocklist or fuzzy-dedupe a LoRA's trigger words, or the LoRA stops working. The
        blocklist matches whole words, so list every form of a word you block (see
        <DocRef id="adult-packs" />). For prose prompts use text mode on Gentle: tags mode splits on
        commas, so it would split sentences.
      </DocCallout>
      <DocImage
        src="images/docs/wp-prompt-cleaner.png"
        ratio="16 / 7"
        caption="A messy tag list goes into WP Prompt Cleaner and comes out without the doubled tags and stray commas. Each rule shows how many fixes it made."
      />
    </DocSection>

    <DocSection title="Inputs and outputs">
      <DocKeyList :items="ports" />
    </DocSection>

    <DocSection title="Mode">
      <p>
        <b>Tags</b> is for comma-separated tag lists, the usual SD style: the Cleaner works tag by
        tag. <b>Text</b> is for sentences: tag rules such as duplicate removal are off, and the
        blocklist removes just the word, not the whole phrase.
      </p>
    </DocSection>

    <DocSection title="Presets">
      <DocKeyList :items="presets" />
    </DocSection>

    <DocSection title="Prompt syntax rules">
      <p>
        Three rules read brackets and tags the way ComfyUI does. They work in both modes and run
        first, so anything they leave behind is tidied in the same run.
      </p>
      <DocKeyList :items="syntaxRules" />
      <DocCallout variant="tip">
        Escaped <code>\(</code> <code>\)</code> stay literal, LoRA and embedding names are never
        edited, and if the brackets don't balance the bracket rules leave the prompt exactly as
        written.
      </DocCallout>
    </DocSection>

    <DocSection title="Cleaning the negative">
      <p>
        With a negative wired in, one Cleaner cleans both. The rule list gets a second column of
        tick boxes for the negative. It follows the prompt column, except near-duplicate removal
        and the blocklist are off: near-duplicates in a negative are usually on purpose, and
        blocked words often belong in a negative.
      </p>
      <p>
        <b>Drop negative tags also in prompt</b> (off by default) removes a tag from the negative
        when the prompt asks for it too, since the model can't both draw it and avoid it. Either
        way, the run stats name the tags the two share.
      </p>
    </DocSection>

    <DocSection title="Blocklist">
      <p>
        Add words or phrases you always want removed. Two modes:
      </p>
      <ul>
        <li>
          <b>List:</b> words separated by commas or new lines; capitals don't matter. In Tags mode
          the whole tag with the word goes; in Text mode just the word.
        </li>
        <li>
          <b>Regex:</b> one pattern per line; capitals don't matter. A broken pattern is skipped
          and named in the run stats.
        </li>
      </ul>
      <DocCallout variant="tip">
        Hover a rule for what it does. After a run, the count next to each rule shows what it
        removed.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-prompt-assembler', label: 'WP Prompt Assembler', icon: 'pi pi-align-left', tone: 'node' },
          { id: 'negatives', label: 'Negatives', icon: 'pi pi-minus-circle', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
