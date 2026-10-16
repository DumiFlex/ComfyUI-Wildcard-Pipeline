<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="How it connects"
    title="Bundles"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="Group a contiguous module range into a reusable snapshot. Library bundles follow module edits; copies on the canvas show when the library has moved on."
  >
    <DocSection title="What a bundle is">
      <p>
        A <b>bundle</b> groups a contiguous range of modules in a Context into a named, collapsible
        unit. You can collapse it in the module stack to keep long setups tidy, and you can save it
        to the library to reuse the whole group in other Contexts or workflows.
      </p>
      <p>
        At generation time the bundle is transparent — its modules run inline exactly as if they
        had been placed directly in the stack. The bundle is purely an organisational tool; it does
        not add any processing of its own.
      </p>
      <DocImage
        src="images/docs/bundles-concept.png"
        ratio="16 / 6"
        caption="Three nodes side-by-side. Left WP Context shows the Starter set bundle expanded — six child rows (Starter subject, pairing, mood, style, scene, accent) nested under the bundle frame. Middle WP Context shows the same bundle COLLAPSED into a single row. Right WP Prompt Assembler reads the resolved $vars from either Context the same way — the bundle is transparent at runtime."
      />
    </DocSection>

    <DocSection title="Snapshots">
      <p>
        When you capture a bundle, the current state of each module (its options, settings and
        metadata) is saved into the bundle as a snapshot, and the bundle resolves from that
        snapshot.
      </p>
      <ul>
        <li>
          Saving a module in the library updates its snapshot in every <b>library</b> bundle that
          holds it. The bundle's own per-use settings stay.
        </li>
        <li>
          Bundles already on a <b>canvas</b> keep their snapshot until you pull the change: the
          header shows <b>library updated</b>, and <b>Reset to library snapshot</b> (bundle) or
          <b>Refresh from library</b> (one row) brings it in. <b>Push to library…</b> goes the
          other way.
        </li>
      </ul>
      <DocCallout variant="tip">
        Because bundle children are snapshots, deleting a source wildcard from the library does not
        break bundles that captured it. The bundle keeps working. A MISSING badge appears on the
        workflow row to signal that the library entry is gone, so you can decide whether to
        replace it or leave it as-is.
      </DocCallout>
    </DocSection>

    <DocSection title="Disabling a bundle">
      <p>
        Each bundle has an <b>enabled</b> toggle. Disabling a bundle suppresses all its children
        without touching their individual settings. Re-enabling it restores them exactly as they
        were. This lets you mute an entire group of modules in one click during testing without
        having to disable each one separately.
      </p>
    </DocSection>

    <DocSection title="Inserting a bundle">
      <p>
        When you drop a saved bundle into a Context, each child keeps its library id, so it stays
        linked to the library entry and <VarToken kind="ref">@{uuid}</VarToken> references and
        constraint pairings inside the bundle keep working as they are. Each child gets its own
        row id on the canvas, so inserting the same bundle twice gives two independent rows of
        each module.
      </p>
      <p>
        Two copies still write the same <VarToken>$variables</VarToken>, and the later one wins.
        To keep both, rename the second copy's variables (each child's Variable binding), or use
        Duplicate on single rows, which renames for you (<VarToken>$hair</VarToken> becomes
        <VarToken>$hair_2</VarToken>).
      </p>
      <p>
        <b>Extract to library</b> in the bundle editor is the one step that makes new ids: it
        turns the children into stand-alone library modules (a fork), rewires the references
        between them to the new ids, and leaves per-use overrides behind.
      </p>
    </DocSection>

    <DocSection title="Bundles are not a module kind">
      <p>
        Bundles are a grouping and portability mechanism, not a processing step. They have no
        module type, no kind colour, and no engine handler of their own. Everything they contribute
        to the pipeline comes from their children.
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'bundles', label: 'Bundles', icon: 'pi pi-box', tone: 'bundle' },
          { id: 'wp-context', label: 'WP Context', icon: 'pi pi-sitemap', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
