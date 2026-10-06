<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const ports = [
  { term: "prompt (in)", desc: "The text to clean. Typically from a WP Prompt Assembler, but works with any STRING source." },
  { term: "cleaner widget", desc: "Configure the cleaning rules: pick a mode, set an intensity preset, toggle individual rules on or off, and manage the blocklist. The widget also shows run-stats after each execution." },
  { term: "negative (in)", desc: "Optional. A negative prompt to clean alongside the prompt — type it in the box or wire one in, typically the Assembler's negative output. Left empty, the negative output is empty." },
  { term: "prompt (out)", desc: "The cleaned text, ready to wire into a CLIP Text Encode or any other text consumer. Stays output 0." },
  { term: "negative (out)", desc: "The cleaned negative, using the negative column's rules. Wire it into your negative CLIP Text Encode." },
];

const presets = [
  { term: "Gentle", desc: "Whitespace normalization only — collapses extra spaces, strips leading/trailing gaps. Safest option when you want minimal changes." },
  { term: "Balanced", desc: "Adds empty-group removal, LoRA tag spacing, punctuation cleanup and exact tag deduplication on top of gentle. None of these change what the prompt means. Good default for most prompt workflows." },
  { term: "Aggressive", desc: "Also merges nested weights and enables fuzzy deduplication, which catches near-duplicate tags that differ by pluralisation or minor spelling. May occasionally merge things you intended to keep separate." },
  { term: "Custom", desc: "No preset — a Custom badge lights up when your per-rule toggles diverge from the active preset level." },
];

const syntaxRules = [
  { term: "Empty groups", desc: "Removes brackets with nothing inside: (), [], ( , ), (:1.2), and groups left empty once those go. red (), dress becomes red, dress. The usual source is a weighted ref that resolved to nothing: (@{hat}:1.2) becomes (:1.2). On from Balanced." },
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
    blurb="Polish any prompt string before it reaches your sampler — remove duplicates, strip stray punctuation, and block unwanted words, all with a single configurable node."
  >
    <DocSection title="What it's for">
      <p>
        Wire any prompt string — typically from a <b>WP Prompt Assembler</b> — into the
        Cleaner and it applies a configurable set of rules: whitespace normalization, prompt
        syntax tidying (empty groups, nested weights, LoRA tags), tag deduplication, fuzzy
        matching, and an optional blocklist. The cleaned text comes out
        the other side ready to wire into a CLIP Text Encode. It works on text alone and
        needs no Context connection.
      </p>
      <DocImage
        src="images/docs/wp-prompt-cleaner.png"
        ratio="16 / 5"
        caption="WP Prompt Cleaner fed a deliberately messy 40-word / 297-char tag dump (duplicate 'highly detailed', orphan '!!' + '---' punctuation, near-duplicates like 'ultra realistic' vs 'ultra-realistic', blocklist hits watermark / low quality / bad anatomy / signature). Mode = tags · Intensity = aggressive. Rules pane lists hits per family — whitespace 3 · punctuation 6 · tag dedupe 3 · fuzzy dedupe 3 · blocklist 4 — plus a 'Blocklist · 4 entries · list' button. The Show Any node on the right renders the cleaned single-line output."
      />
    </DocSection>

    <DocSection title="Inputs &amp; output">
      <DocKeyList :items="ports" />
    </DocSection>

    <DocSection title="Mode">
      <p>
        Choose <b>Tags</b> mode when your prompt is a comma-separated tag list (the default
        for most SD workflows). The cleaner splits on commas, applies all rules per-tag, and
        reassembles. Choose <b>Text</b> mode for prose-style prompts — tag-only rules like
        deduplication are disabled, and the blocklist removes matched words without pulling
        the whole phrase.
      </p>
    </DocSection>

    <DocSection title="Intensity presets">
      <DocKeyList :items="presets" />
    </DocSection>

    <DocSection title="Prompt syntax rules">
      <p>
        Three rules read the prompt the way ComfyUI does. They work in both modes and run
        first, so the commas and spaces they leave behind are tidied in the same run.
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
        With a negative wired in, one Cleaner cleans both prompts. The rule list gets a second
        column of checkboxes for the negative, with its own defaults: the same as the prompt
        column's, except fuzzy dedupe and the blocklist are off. Near-duplicates in a negative ("bad hands", "bad hand") are usually
        deliberate, and the blocklist's words are often exactly what belongs in a negative.
        Presets set both columns; changing a negative checkbox marks the preset as custom.
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
          <b>List</b> — comma or newline-separated words, matched case-insensitively. In tags
          mode the entire tag containing the match is removed; in text mode only the matched
          word is removed and any orphan punctuation cleaned up around it.
        </li>
        <li>
          <b>Regex</b> — one pattern per line. Patterns are matched case-insensitively.
          Invalid patterns are skipped and reported in run-stats.
        </li>
      </ul>
      <DocCallout variant="tip">
        Hover any rule toggle for an inline explanation. After each run, the stat counters
        next to each active rule show exactly what was dropped — a quick sanity check that
        your rules are working as expected.
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
