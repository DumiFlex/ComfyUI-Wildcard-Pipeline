<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="Overview"
    title="Library health"
    icon="pi pi-heart"
    tone="neutral"
    blurb="One page that checks your whole library: what is broken, what looks like a mistake, and what is clutter, each with a way to fix it."
  >
    <DocSection title="What it's for">
      <p>
        After a few months of imports, AI packs and deletes, a library collects references to
        wildcards that are gone, constraint rules for options that were renamed, near-duplicates and
        items nothing uses. The canvas warnings only look at one chain. <b>Library health</b>, in the
        manager sidebar under Library, looks at everything at once.
      </p>
      <DocImage
        src="images/docs/library-health.png"
        ratio="2 / 1"
        caption="Library health: the three counts at the top, the filter and search, and one fold-out list per check, each row with Open and Ignore."
      />
      <p>
        The sidebar entry shows a red count when there are problems and an amber one when there
        are only warnings, and the Dashboard shows the same counts with the first problem. The page
        checks again on its own a moment after you change the library; <b>Check again</b> runs it
        now.
      </p>
    </DocSection>

    <DocSection title="Problems: print wrong or nothing">
      <DocKeyList
        :items="[
          { term: 'Points at a wildcard that’s gone', desc: 'A @{reference} in an option, combine, fixed value, derivation, saved template or bundle copy names a wildcard no longer in the library. It prints nothing where it sits.' },
          { term: 'Constraint lost its wildcard', desc: 'Its source or target wildcard was deleted, so it never applies.' },
          { term: 'Constraint rule for an option or tag that’s gone', desc: 'A matrix tag or an exception value the wildcard no longer has. That rule never matches.' },
          { term: 'Bundle holds a bundle that’s gone', desc: 'A nested bundle was deleted, so inserting the outer one skips it.' },
          { term: 'Empty bundle', desc: 'Inserting it adds nothing.' },
          { term: 'Wildcard can’t pick anything', desc: 'No options, only the empty option, or every option at weight 0 with no fallback.' },
          { term: 'Reads a variable nothing sets', desc: 'A $variable no library item, WP Model Info, WP Context Loop or the open canvas sets. Unless a WP Context Injector sets it, it prints as empty.' },
        ]"
      />
    </DocSection>

    <DocSection title="Warnings: probably a mistake">
      <DocKeyList
        :items="[
          { term: 'No name', desc: 'Hard to find in pickers and references.' },
          { term: 'Same name twice', desc: 'Two items of one kind with one name. The row links to both.' },
          { term: 'Wildcards with the same options', desc: 'Often a pack imported twice.' },
          { term: 'Same option listed twice', desc: 'It rolls twice as often. Raise one option’s weight instead.' },
          { term: 'Options that never roll', desc: 'Weight 0 and not the fallback.' },
          { term: 'Two wildcards write the same variable', desc: 'On one chain the later one wins, which is fine when they are alternatives.' },
          { term: 'Bundle copies of deleted items', desc: 'The bundle still runs its copies, but they no longer follow the library. Open the bundle to relink them.' },
        ]"
      />
    </DocSection>

    <DocSection title="Tidy up: clutter">
      <DocKeyList
        :items="[
          { term: 'Not used by any bundle, template or reference', desc: 'Nothing in the library uses it, and it is not on the open canvas. Delete all removes every one shown, after one confirm.' },
          { term: 'Sets a variable nothing in the library reads', desc: 'A combine, derivation or fixed value whose variable no saved template, combine, derivation or open Assembler prints.' },
          { term: 'Bundle holds an older copy', desc: 'The library item changed since the bundle was saved.' },
          { term: 'Tag used only once', desc: 'With a hint when it looks like a typo of another tag (outfit / outfits).' },
          { term: 'Empty category', desc: 'Nothing is filed under it. Delete removes the category only.' },
          { term: 'Newer version on Community', desc: 'The author published a newer version of a pack you installed. Update opens the same dialog as the list pages.' },
          { term: 'Installed from a newer format', desc: 'It came from a newer Wildcard Pipeline, so settings this version doesn’t know were left out. Update the extension and reinstall it.' },
        ]"
      />
    </DocSection>

    <DocSection title="Open your canvas first">
      <p>
        A WP Context keeps its own copy of what you insert, so the library can't tell what sits on a
        canvas. When a ComfyUI tab is open, the page asks it which library items it holds, which
        variables its Injectors, Loops and Model Info set, and which <VarToken>$variables</VarToken> its
        Assemblers read, and counts those as used. Ids and names only, never values.
      </p>
      <DocCallout variant="tip">
        With no canvas open, the page says so: items you only use on a canvas show under
        <b>Not used</b>. Open your workflow in another tab and press <b>Check again</b>, or Ignore them.
      </DocCallout>
    </DocSection>

    <DocSection title="Fix, ignore, filter">
      <DocKeyList
        :items="[
          { term: 'Open', desc: 'Opens the item’s editor (a tag opens the items carrying it). Rows about two items, like duplicates, link to each one.' },
          { term: 'Delete', desc: 'Only on rows where it is safe: unused items and empty categories. Copies on a canvas keep working, and a backup from Settings › Library & data can bring an item back.' },
          { term: 'Ignore', desc: 'Hides the row for good and leaves it out of the counts. Show ignored brings ignored rows back so you can Unignore them. If the same item turns up for a different reason, it shows again.' },
          { term: 'Filter and search', desc: 'All, Problems, Warnings or Tidy up, and a search over item names, details and values.' },
        ]"
      />
    </DocSection>

    <DocSection title="Variety check">
      <p>
        Under the findings, every bundle has <b>Check variety</b>. It runs the bundle 200 times with
        random seeds through the real engine and shows how many of the results were different,
        which variables never changed although their wildcard has more options, which options never
        came up, and the run's warnings. <b>Open in Test Runner</b> takes the same bundle to the
        Test Runner for a closer look.
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'test-runner', label: 'Test Runner', icon: 'pi pi-bolt', tone: 'neutral' },
          { id: 'warning-types', label: 'Warning & conflict types', icon: 'pi pi-list', tone: 'neutral' },
          { id: 'bundles', label: 'Bundles', icon: 'pi pi-box', tone: 'bundle' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
