<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
</script>

<template>
  <DocPage
    group="AI assistant"
    title="Organize and import"
    icon="pi pi-folder"
    tone="neutral"
    blurb="Sort your library into categories, tags and ratings, tidy an imported wildcard pack, and decide whether the assistant may delete."
  >
    <DocSection title="Organize the library">
      <ol>
        <li>Select up to 60 modules or bundles in any library list.</li>
        <li>Press <b>Organize with AI</b> in the selection bar. Type a note first to steer it if
          you like ("one category per subject").</li>
        <li>Review the suggestions: a <b>category</b>, <b>tags</b> to add or remove, and a
          <b>content rating</b> change (Safe or NSFW) where the content calls for it. Each comes with
          a short reason.</li>
        <li>Click a chip to leave that change out, or untick an item. <b>Apply</b> saves right away,
          and the toast that follows has <b>Undo</b>.</li>
      </ol>
      <p>
        It reuses your categories and tags where they fit; new ones are dashed and created when you
        apply. Bundles have no category. Only items that would change are listed.
      </p>
      <p>
        In the chat you can also ask for this directly: "make a Weather category", "rename Clothes to
        Outfits", "rename #warm to #cozy". Renaming a tag to one you already have merges the two.
      </p>
    </DocSection>

    <DocSection title="Tidy up an imported wildcard pack">
      <p>
        Packs imported in <b>Import / Export → Wildcard packs</b> arrive as flat lists. After the
        import, press <b>Tag and connect with AI</b>. The chat opens and asks the assistant to tag
        the options, group the tags, link the lists with constraints (with a fallback where a rule
        could leave a list empty), gather them into a bundle and run a test. Every change is a card;
        the option text stays as it was.
      </p>
    </DocSection>

    <DocSection title="Permissions">
      <p>Both switches are in <b>Settings › AI assistant › Permissions</b>, off by default. The assistant can't change them.</p>
      <ul>
        <li><b>Let the assistant delete items.</b> The chat can then propose deleting modules,
          bundles, templates, categories and tags, up to 10 per card. The card says what uses each
          item and asks you to confirm. Undo brings everything back at the same ids, so references
          work again. Saved workflows keep their own copy of a deleted module.</li>
        <li><b>Apply small changes automatically.</b> New descriptions, tags and categories are
          applied without a click; the card says <b>Applied automatically</b> and keeps its Undo.
          Ratings, content changes, renames and deletes always wait for you.</li>
      </ul>
      <DocCallout variant="tip">
        Describe on an item's Identity card writes its description and tags one item at a time. See
        Draft with AI.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'ai-chat', label: 'Chat', icon: 'pi pi-comments', tone: 'neutral' },
          { id: 'ai-drafts', label: 'Draft with AI', icon: 'pi pi-pencil', tone: 'neutral' },
          { id: 'wildcard', label: 'Wildcard', icon: 'pi pi-sparkles', tone: 'wildcard' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
