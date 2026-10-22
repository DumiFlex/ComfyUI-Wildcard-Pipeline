<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
</script>

<template>
  <DocPage
    group="AI assistant"
    title="Web search and tag lookup"
    icon="pi pi-globe"
    tone="neutral"
    blurb="Let the assistant look things up on the web or on Danbooru, and use your own tag list, LoRAs and embeddings. Off by default, and it asks before each call."
  >
    <DocSection title="Set up web search">
      <p>
        Open <b>Settings › AI assistant › Web search</b> and pick an engine:
      </p>
      <ul>
        <li><b>SearXNG</b>, your own server. Add <code>json</code> to <code>search.formats</code> in
          its <code>settings.yml</code>, or it refuses the chat's searches.</li>
        <li><b>Brave Search</b>, <b>Tavily</b> or <b>Kagi</b> with a key. The key stays on the
          ComfyUI machine and only goes to that engine.</li>
      </ul>
      <p>
        Once set up, the assistant searches when references would help (a character's outfit, an
        art style, a new model's tags), not only when you ask. It takes effect in open chats from the
        next message.
      </p>
    </DocSection>

    <DocSection title="It asks first">
      <p>
        Every search shows the exact words it wants to search for, with <b>Allow once</b>,
        <b>Allow for this chat</b> (no more asking in this chat for the next 8 hours) and
        <b>Deny</b>. Only the search words leave your PC. Five short
        results come back, and the assistant cites them as [1], [2] with the link.
      </p>
      <p>
        When a result's snippet isn't enough, it can ask to <b>read that page</b>. It only reads
        links its own allowed searches returned, never another address, and asks first.
      </p>
      <DocKeyList
        :items="[
          { term: 'Built in', desc: 'The default. ComfyUI fetches the page and keeps its visible text (a few thousand characters). It never opens an address on your own network. Pages that need JavaScript, a login or a browser check give little.' },
          { term: 'Crawl4AI / Firecrawl', desc: 'Your own server (or Firecrawl\'s hosted API with a key) renders pages in a real browser first.' },
          { term: 'Off', desc: 'No page reading.' },
        ]"
      />
      <DocCallout variant="warn">
        <b>Don't ask before web calls</b> skips the Allow card for searches, page reads and Danbooru
        lookups. You still see each one above the answer, but a web page or an item could then steer
        what the chat sends out.
      </DocCallout>
      <p>
        Turning a web feature on shows a short note of what leaves your machine. <b>Got it</b> hides
        it, and <b>Show dismissed notices again</b> brings it back.
      </p>
    </DocSection>

    <DocSection title="Danbooru tag lookup">
      <p>
        Off by default. When on, the chat can ask danbooru.donmai.us about one tag: post count,
        category, alias, what it implies, its wiki text and the tags used with it most. It reads tags
        and wiki pages only, never posts or images, waits a second between requests and asks you each
        time.
      </p>
    </DocSection>

    <DocSection title="Your tags, LoRAs and embeddings">
      <p>
        While an autocomplete source is on (<b>Settings › Autocomplete</b>), the chat and the pack
        builder can look in your downloaded <b>Danbooru tag list</b> (real spellings and post
        counts), your <b>LoRA</b> files and your <b>embeddings</b>. This stays on your PC, apart from
        what the model reads. For spellings and post counts the chat uses this list instead of the
        Danbooru lookup.
      </p>
      <p>
        The assistant also knows how the nodes work (the Loop's <code>$iteration</code>, sweeps and
        holds, Injector rows, WP Model Info's <code>$model_family</code>, <code>$model_variant</code>
        and <code>$model_name</code>, the Image Filter). With the canvas open in another tab, it knows
        which variables your canvas sets at run time, so a pack reading them isn't flagged.
      </p>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'ai-chat', label: 'Chat', icon: 'pi pi-comments', tone: 'neutral' },
          { id: 'ai-privacy', label: 'Privacy and safety', icon: 'pi pi-lock', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
