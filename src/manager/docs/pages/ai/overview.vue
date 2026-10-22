<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
</script>

<template>
  <DocPage
    group="AI assistant"
    title="AI assistant"
    icon="pi pi-microchip-ai"
    tone="neutral"
    blurb="Optional and off by default. Connect a model you choose, and it helps you write modules, answer questions and build whole packs. You review every change before anything is saved."
  >
    <DocSection title="What it does">
      <p>
        The assistant uses a model <em>you</em> bring: one running on your own PC (Ollama,
        LM Studio, llama.cpp or any OpenAI-compatible server) or the Claude or OpenAI API with
        your own key. Wildcard Pipeline ships no model and sends nothing anywhere until you turn
        the assistant on.
      </p>
      <p>Once it's on, you can:</p>
      <ul>
        <li><b>Draft in the editors.</b> Press <b>AI</b> in any editor to write new wildcard
          options, rules, fixed values, combines or templates, or to rewrite, retag and re-weight
          what's there.</li>
        <li><b>Chat.</b> Ask about your library or how something works, or ask for a change. Every
          change comes back as a card you apply or dismiss.</li>
        <li><b>Build a whole pack</b> from one description: the wildcards, rules, template and a
          bundle, tested on the engine before you install them.</li>
        <li><b>Organize your library:</b> descriptions, tags, categories and ratings.</li>
        <li><b>Ask about a Test Runner run:</b> why an option never comes up, or how to fix a
          warning.</li>
        <li><b>Look things up</b> on the web or on Danbooru, if you set that up. It asks before
          each search.</li>
      </ul>
      <DocCallout variant="tip">
        Every request includes the item's name, description and tags, so a good description
        points the model the right way.
      </DocCallout>
    </DocSection>

    <DocSection title="Start here">
      <ol>
        <li><DocRef id="ai-setup" />: pick a provider and a model, then press <b>Test connection</b>.</li>
        <li>Open a wildcard and press <b>AI</b> above its options. <DocRef id="ai-drafts" /> shows
          the rest of the editor tools.</li>
        <li>Press <b>AI</b> in the top bar to open the <DocRef id="ai-chat" label="chat" />.</li>
        <li>When you're ready for more, try the <DocRef id="ai-pack-builder" />.</li>
      </ol>
    </DocSection>

    <DocSection title="You stay in control">
      <ul>
        <li>Nothing is saved until you press <b>Apply</b>, <b>Add</b> or <b>Save</b>. Most
          changes have <b>Undo</b>.</li>
        <li>It can't delete anything unless you allow it in Settings, and every delete asks you
          first.</li>
        <li>It only goes online through web search, and asks before each search.</li>
      </ul>
      <p>Details are on <DocRef id="ai-privacy" />.</p>
    </DocSection>

    <DocSection title="Which model?">
      <p>
        Any model can draft options. Rules, chat and the pack builder need a model that follows
        instructions well. A 9B model on a 16 GB card can run the chat. Claude and OpenAI don't
        write explicit content, so for NSFW packs run an uncensored model yourself.
        <DocRef id="ai-setup" /> lists suggestions, and <DocRef id="ai-troubleshooting" /> helps
        when a small model struggles.
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'ai-setup', label: 'Set up a model', icon: 'pi pi-cog', tone: 'neutral' },
          { id: 'ai-drafts', label: 'Draft with AI', icon: 'pi pi-pencil', tone: 'neutral' },
          { id: 'ai-chat', label: 'Chat', icon: 'pi pi-comments', tone: 'neutral' },
          { id: 'ai-pack-builder', label: 'Pack builder', icon: 'pi pi-box', tone: 'neutral' },
          { id: 'test-runner', label: 'Test Runner', icon: 'pi pi-bolt', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
