<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocDetails from "../../../components/docs/DocDetails.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

const importRules = [
  { term: "Lists and their names", desc: "Each list is named by its path the way __name__ finds it: animals/cats.txt is animals/cats, and a YAML key clothing: { tops: [...] } is clothing/tops. A list that isn't merged becomes its own wildcard, and its variable is the last part ($cats, $tops)." },
  { term: "Merging related lists", desc: "With Merge related lists ticked (the default), a folder of small lists becomes one wildcard, like one you'd build by hand: hair/colors/red.txt, hair/colors/blonde.txt and hair/colors/dark.txt become one hair/colors wildcard whose options are tagged red, blonde and dark. Each folder level is a tag group, and lists with the same name in sibling folders share a tag: female/footwear and male/footwear give a gender group (female, male) and a footwear tag, like the axes of a hand-built wildcard. A folder merges when it holds at least two lists and up to 1,000 options over at most three levels; a bigger folder is split into its subfolders. Entry points stay separate, and so does a list that points at another list in the same folder, because a wildcard can't reference itself." },
  { term: "Tables", desc: "When the subfolders of a folder repeat the same list names (beings/elf/prompt.txt, beings/orc/prompt.txt, …) each list name becomes one table wildcard, tagged by the folders in between, so the folder becomes a tag group you can filter or steer. The row shows a table chip." },
  { term: "Tag groups", desc: "Open a merged row to see its tag groups. Each one is named after the folder level it came from; type a better name and the pack converts again with it." },
  { term: "Keep separate", desc: "Merged rows show a lists chip. Open one to see each list with its tag and the tag groups, and click Keep these lists separate to import that folder as one wildcard per list again; Merge again under the settings undoes it. Untick Merge related lists to keep every list separate." },
  { term: "Roles", desc: "The review sorts every wildcard by what it does in the pack. Entry points build a prompt from other wildcards and nothing else uses them. Stacks are modules that run together as one bundle. Compositions build on other wildcards and are used by one. Vocabulary is a plain list. Groups are made for globs and folder references. Copies and stack parts are small wildcards the import built for template references and stacks." },
  { term: "Carries over", desc: "Each wildcard is marked Exact, Close (same outputs, but a setting or label didn't carry over) or Needs a look (some text no longer renders as it did). Open a row to see why." },
  { term: "Sample rolls", desc: "The import rolls each stack and entry point a few times on the real engine. Open a row to see what it makes. A warning from those rolls marks the row Needs a look." },
  { term: "Domains", desc: "The top folders (or YAML top keys) of the pack. Pick one to review it on its own. Each wildcard goes in a category named after its domain, unless you type one category for all." },
  { term: "Library tag", desc: "Every module gets the library tag, which starts as the pack's name, so the whole pack sits together on the Tags page." },
  { term: "Bundles", desc: "Stacks only (the default) makes one bundle per stack and nothing else. Stacks + entry points by folder also puts the entry points into one bundle per domain, inside one pack bundle. None makes no bundles. Lists always stay in the library, where references reach them." },
  { term: "References", desc: "__other__ references become @{} chips that point at the imported wildcard. A reference to a list that was merged points at the merged wildcard, filtered by that list's tags, so it still draws from that list only. A glob like __animals/*__, or a parent key like __clothing__ in Impact packs, becomes a group wildcard that picks one of the matching wildcards, weighted by how many options each has. PPP filters such as __colors'warm'__ become a category filter on the chip. A reference to a wildcard from an earlier import of the pack links to the one in your library." },
  { term: "Variables", desc: "A line that sets variables and then uses them (Dynamic Prompts ${season=!{winter|summer}}, PPP <ppp:set>) becomes a stack: a wildcard that rolls each variable once, then a Combine that writes the line into a variable. ${x=v} without ! rolls again at each use, as in Dynamic Prompts. Defaults like ${x:dry} become a derivation that fills the variable only when nothing set it. A variable nothing sets is left for you to fill upstream of the stack." },
  { term: "Template arguments", desc: "__outfit(season=winter)__ makes a copy of the outfit list with the variable filled in. When several entry points are copies of one template that differ by one value, Fold template copies (on by default) turns them into one wildcard plus a choice that picks the value, with constraints that keep each pair together. Pin the choice to get one of the originals back." },
  { term: "If-conditions", desc: "A PPP <ppp:if> that tests a variable the line rolls becomes a constraint: the options behind each branch only show when the condition holds. A test on the model (_is_sdxl, _is_pony, …) becomes a model check stack: put it after a WP Model Info node and it leaves out what the pack rules out for the loaded model. Conditions on anything else are removed, and the choice stays." },
  { term: "Negatives and LoRAs", desc: "PPP <ppp:stn>…</ppp:stn> and Umi **text** go to the option's negative, so the Assembler's negative output carries them. PPP <ppp:ext lora …> becomes <lora:name:weight> text." },
  { term: "Umi AI packs", desc: "In Umi YAML the key is the prompt and Tags: lists its tags. Tag queries like <[female][casual|--formal]> become a pick from the matching entries, weighted the same way. Yaml Tags.txt names the tag groups. {20%a|b} weights carry over." },
  { term: "Choice syntax", desc: "{a|b}, weights like {2::a|b} and multi-pick like {2$$a|b|c} keep working, and so does __2$$name__: it picks two different values of name. Open ranges like {-2$$a|b} get their missing end filled in, samplers like {~a|b} pick at random, and the default separator is a comma." },
  { term: "Weights, labels and fallbacks", desc: "Weighted lines (3::text), PPP labels ('summer, casual'::text) and PPP's else choice carry over as option weights, sub-categories and the wildcard's fallback. A line written twice becomes one option with twice the weight, so the odds stay the same." },
  { term: "Comments and encoding", desc: "Lines starting with # are skipped and kept as the module's description, as is the # text inside multi-line YAML prompts. Text after a # with a space before it is cut (so C# survives). Files saved as UTF-8 or Windows-1252 both read correctly." },
];
</script>

<template>
  <DocPage
    group="Modules"
    title="Import wildcard packs"
    icon="pi pi-download"
    tone="wildcard"
    blurb="Bring in wildcard packs from A1111, Forge, Dynamic Prompts, PPP, Impact Pack or Umi AI. Folders of lists become tagged wildcards, and the pack's variables and if-conditions become stacks you can drop on a Context."
  >
    <DocSection title="Import a pack">
      <ol>
        <li>Open <b>Import / Export → Wildcard packs</b>.</li>
        <li>Choose a folder, files or a <code>.zip</code>, or drop them on the page. It reads
          <code>.txt</code> lists and <code>.yaml</code>, <code>.yml</code> and <code>.json</code>
          files. Wildcard folders of extensions installed in ComfyUI (Impact Pack, Dynamic Prompts,
          Easy-Use, PPP, LoRA Manager) are listed below: click <b>Convert</b> to use one.</li>
        <li>Review the plan: what each list becomes and how well it carries over.</li>
        <li>Pick what to import (everything starts selected) and import.</li>
      </ol>
      <p>
        Importing the same pack again finds the wildcards you already have instead of adding copies.
      </p>
      <DocImage
        src="images/docs/wildcard-import.png"
        ratio="8 / 5"
        caption="A small fantasy pack in review: 49 files become 11 wildcards, 43 lists merged into 5 tagged wildcards. Open here is characters, 11 lists merged into one wildcard; each list shows the tags that pick it, and Keep these lists separate undoes the merge."
      />
    </DocSection>

    <DocSection title="What you get">
      <ul>
        <li><b>Folders of small lists become one tagged wildcard.</b> hair/colors/red.txt and
          hair/colors/blonde.txt become one hair/colors wildcard whose options are tagged red and
          blonde. Untick <b>Merge related lists</b> to keep every list separate.</li>
        <li><b>Logic becomes stacks.</b> A line that rolls variables, a template reference with
          arguments or an if-condition becomes a bundle of modules that run together: wildcards that
          roll each variable once, constraints that keep picks consistent, and a Combine that writes
          the prompt. Drop it on a Context.</li>
        <li><b>You see what it makes.</b> Each stack and entry point is rolled a few times on the
          real engine before you import, and the review shows those prompts.</li>
        <li><b>References keep working.</b> <code>__name__</code> becomes an <code>@{}</code> chip
          pointing at the imported wildcard, and <code>{a|b}</code> choices work as before.</li>
        <li><b>Everything gets the pack's tag</b> and a category per top folder, so the pack stays
          together in your library.</li>
      </ul>
      <DocCallout variant="warn">
        Rows marked <b>Needs a look</b> list what changed. An <code>if</code> on something the
        pack never rolls once is removed (the choice stays), an <code>if</code> inside a
        <code>{…}</code> choice keeps only its else branch, a variable read inside a <code>{…}</code> choice rolls its own value, and a
        reference to a list the pack doesn't contain stays as text.
      </DocCallout>
    </DocSection>

    <DocSection title="The details">
      <DocDetails title="How each part of a pack is converted">
        <DocKeyList :items="importRules" />
      </DocDetails>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
          { id: 'bundles', label: 'Bundles', icon: 'pi pi-box', tone: 'bundle' },
          { id: 'chips-and-references', label: 'Chips &amp; references', icon: 'pi pi-tag', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
