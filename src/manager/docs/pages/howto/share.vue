<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";
</script>

<template>
  <DocPage
    group="How to"
    title="Share a pack or workflow"
    icon="pi pi-share-alt"
    tone="neutral"
    blurb="Send someone your workflow, a file of modules, or publish a pack to the community."
  >
    <DocSection title="Share a workflow">
      <p>
        Save the workflow in ComfyUI as usual and send the file. Every row on a WP Context is a
        copy of the module, so the workflow runs on another machine even if that library is
        empty.
      </p>
      <ul>
        <li>An <VarToken kind="ref">@{…}</VarToken> reference looks on the node first, then in the
          library. Keep every wildcard a reference needs on the node (switched off is fine) and it
          works anywhere.</li>
        <li>The person you send it to sees <b>missing</b> on rows they don't have. Right-click →
          <b>Save to library</b> adds them.</li>
        <li>Per-frame changes and the loop's settings are saved in the workflow too.</li>
      </ul>
    </DocSection>

    <DocSection title="Share modules as a file">
      <ol>
        <li>In the manager open <b>Import / Export</b> → <b>Export</b>.</li>
        <li>Tick what to share: the whole library, a kind, or single modules and bundles.
          <b>Select with dependencies</b> adds the wildcards they reference.</li>
        <li>Download the file and send it.</li>
      </ol>
      <p>
        To bring one in, use the <b>Import</b> tab: pick the file or paste its text, choose what to
        add, and decide what happens when a name already exists. An import can be undone from the
        message that follows.
      </p>
    </DocSection>

    <DocSection title="Publish to the community">
      <p>
        On a module or bundle, the <b>Publish to community</b> button opens the publish form with
        everything filled in; the Export tab has the same button for a selection. Others find it
        in the <b>Community</b> tab and install it in one click, with the wildcards it needs.
      </p>
      <DocCallout variant="tip">
        A pack that uses a newer feature asks people on an older version to update before it
        installs, so nothing gets dropped on the way.
      </DocCallout>
    </DocSection>

    <DocSection title="Coming from A1111 or Forge">
      <p>Text and YAML wildcard packs import directly: see <DocRef id="wildcard-import" />.</p>
    </DocSection>

    <DocSection title="Related">
      <CrossLinks
        :links="[
          { id: 'bundles', label: 'Bundles', icon: 'pi pi-box', tone: 'bundle' },
          { id: 'wildcard-import', label: 'Import wildcard packs', icon: 'pi pi-download', tone: 'wildcard' },
          { id: 'pack-structure', label: 'Recommended pack structure', icon: 'pi pi-th-large', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
