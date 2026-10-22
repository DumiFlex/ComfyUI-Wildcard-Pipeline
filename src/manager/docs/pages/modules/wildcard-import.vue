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
  { term: "Keep separate", desc: "Merged rows show a lists chip. Open one to see each list with its tag and the tag groups, and click Keep these lists separate to import that folder as one wildcard per list again; Merge again under the settings undoes it. Untick Merge related lists to keep every list separate." },
  { term: "Roles", desc: "The review sorts every wildcard by what it does in the pack. Entry points build a prompt from other wildcards and nothing else uses them: these are what you drop on a Context. Compositions build on other wildcards and are used by one. Vocabulary is a plain list. Groups are made for globs and folder references." },
  { term: "Carries over", desc: "Each wildcard is marked Exact, Close (same outputs, but a setting or label didn't carry over) or Needs a look (some text no longer renders as it did, like a dropped if-condition). Open a row to see why." },
  { term: "Domains", desc: "The top folders (or YAML top keys) of the pack. Pick one to review it on its own. Each wildcard goes in a category named after its domain, unless you type one category for all." },
  { term: "Library tag", desc: "Every module gets the library tag, which starts as the pack's name, so the whole pack sits together on the Tags page." },
  { term: "Bundles", desc: "With Bundle the entry points ticked (the default) the entry points go into one bundle per domain, inside one pack bundle. Lists stay in the library, where the entry points reach them through references, so dropping a bundle rolls the prompts the pack was written to make, not every list. A pack of plain lists gets no bundles." },
  { term: "References", desc: "__other__ references become @{} chips that point at the imported wildcard. A reference to a list that was merged points at the merged wildcard, filtered by that list's tags (female and footwear), so it still draws from that list only. A glob like __animals/*__, or a parent key like __clothing__ in Impact packs, becomes a group wildcard that picks one of the matching wildcards, weighted by how many options each has. PPP filters such as __colors'warm'__ become a category filter on the chip." },
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
    blurb="Bring in wildcard packs from A1111, Forge, Dynamic Prompts, PPP or Impact Pack. Folders of lists become tagged wildcards and bundles you can drop on a Context."
  >
    <DocSection title="Import a pack">
      <ol>
        <li>Open <b>Import / Export → Wildcard packs</b>.</li>
        <li>Choose a folder, files or a <code>.zip</code>, or drop them on the page. It reads
          <code>.txt</code> lists and <code>.yaml</code>, <code>.yml</code> and <code>.json</code>
          files.</li>
        <li>Review the plan: what each list becomes and how well it carries over.</li>
        <li>Pick what to import (everything starts selected) and import.</li>
      </ol>
      <p>
        Importing the same pack again finds the wildcards you already have instead of adding copies.
      </p>
      <DocImage
        src="images/docs/wildcard-import.png"
        ratio="1148 / 695"
        caption="Billions of Wildcards in review: 2,653 lists become 935 wildcards, 1,896 of them merged into 190 tagged wildcards. Open here is clothings/regular, 12 lists merged into one wildcard with a gender tag group (female, male, unisex) and a garment group; each list shows the tags that pick it, and Keep these lists separate undoes the merge."
      />
    </DocSection>

    <DocSection title="What you get">
      <ul>
        <li><b>Folders of small lists become one tagged wildcard.</b> hair/colors/red.txt and
          hair/colors/blonde.txt become one hair/colors wildcard whose options are tagged red and
          blonde. Untick <b>Merge related lists</b> to keep every list separate.</li>
        <li><b>Entry points go into bundles.</b> The wildcards that build a whole prompt go into one
          bundle per top folder, so dropping a bundle on a Context rolls the prompts the pack was
          written for.</li>
        <li><b>References keep working.</b> <code>__name__</code> becomes an <code>@{}</code> chip
          pointing at the imported wildcard, and <code>{a|b}</code> choices work as before.</li>
        <li><b>Everything gets the pack's tag</b> and a category per top folder, so the pack stays
          together in your library.</li>
      </ul>
      <DocCallout variant="warn">
        Rows marked <b>Needs a look</b> list what changed. PPP <code>if</code> conditions are
        removed (the choice stays), Dynamic Prompts variables like <code>${name}</code> stay as
        plain text (rebuild that part with a Combine), template arguments like
        <code>__name(var=value)__</code> are dropped, and a reference to a list the pack doesn't
        contain stays as text.
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
