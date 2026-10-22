<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocDetails from "../../../components/docs/DocDetails.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
</script>

<template>
  <DocPage
    group="AI assistant"
    title="Troubleshooting"
    icon="pi pi-wrench"
    tone="neutral"
    blurb="Common problems with the assistant and what to do about them, plus how it helps small local models."
  >
    <DocSection title="Common problems">
      <DocKeyList
        :items="[
          { term: 'It can\'t connect', desc: 'Press Test connection in Settings › AI assistant. Check the server is running and the address and port are right. A saved key is only sent to the address it was saved for, so paste it again after changing the address.' },
          { term: 'Refused when using a domain', desc: 'Requests that don\'t come from a local address are refused. If you reach ComfyUI through your own domain name, add it to WP_AI_ALLOWED_HOSTS and restart ComfyUI.' },
          { term: 'Tool calls show as text', desc: 'In Ollama, Qwen 3.5 / 3.6 models pulled from Hugging Face miss the tool-call reader. Make a Modelfile copy as described on Set up a model.' },
          { term: 'It forgets or ignores instructions', desc: 'The model probably has too little context. Load it with at least 16k, or 32k for chats that take several steps (LM Studio: Context Length in the load settings). Ollama gets the Most context to use setting. Test connection warns when it is too small.' },
          { term: 'The reply ends with “Cut off”', desc: 'The model reached its output limit. Thinking models can spend it all before they answer; set Thinking to Off or Low.' },
          { term: 'It\'s slow', desc: 'Turn Thinking off, use a smaller model, or keep the model loaded longer with Unload after. A pack takes one request per item, so a few minutes with a local model is normal.' },
          { term: 'Answers are poor or it gets stuck', desc: 'Use a builder model for chat, rules and packs. Check Model size matches your model. Try Choose the tool first under Advanced. If you also have a cloud provider set up, the chat says once when switching would likely help.' },
          { term: 'The image button is off', desc: 'Your server says the model can\'t see images. Pick a vision model.' },
          { term: 'A card says it\'s out of date', desc: 'The item changed after you asked. Ask again for a fresh card.' },
          { term: 'Try again is unavailable', desc: 'Undo the changes you applied from that answer first.' },
          { term: 'Explicit content is refused', desc: 'Claude and OpenAI don\'t allow explicit writing. Run an uncensored model yourself or use an unmoderated OpenRouter model.' },
        ]"
      />
    </DocSection>

    <DocSection title="Small local models">
      <p>
        A 9B model on a 16 GB card can run the chat. With <b>Model size</b> on small or medium, the
        assistant works differently so a small model makes fewer wrong turns. You don't need to do
        anything for this.
      </p>
      <DocDetails title="What changes for small and medium models">
        <ul>
          <li><b>Fewer tools at a time.</b> The model starts with the tools for the page you're on
            (medium models also get the wildcard, rule, constraint and test tools everywhere) and
            loads more one group at a time. On a local server each step also offers a shortlist of
            tools that fit your message. Every tool says when to use it, which look-alike to use
            instead, and shows a sample call.</li>
          <li><b>Decide, then write.</b> Each step first decides what to call next, then writes the
            reply with the tools out of reach, so it can't stop halfway to ask. Tool steps run with
            thinking off.</li>
          <li><b>One item per step.</b> A request for several items is listed first and then made one
            per step, with the code keeping count.</li>
          <li><b>Worked examples.</b> The model gets up to three calls that worked for similar
            requests: from cards you applied (kept in <code>ai-examples.json</code> beside
            <code>ai.json</code>) plus a few built-in ones.</li>
          <li><b>Recipes.</b> Common asks (an option never comes up, fixing warnings, negatives,
            weights, how-to questions) come with a short list of steps, and a docs question can be
            answered with one <b>explain</b> call.</li>
          <li><b>A progress note.</b> Each later step gets one line saying what the answer has done so
            far.</li>
          <li><b>Shorter memory.</b> The chat is summarised sooner (at half the window for a small
            model).</li>
          <li><b>JSON steps.</b> Tool format Automatic uses JSON steps, where the server also checks
            each call's arguments as the model writes them.</li>
        </ul>
        <p>
          Test connection tries one small-model tool step and says whether it worked.
        </p>
      </DocDetails>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'ai-setup', label: 'Set up a model', icon: 'pi pi-cog', tone: 'neutral' },
          { id: 'ai-chat', label: 'Chat', icon: 'pi pi-comments', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
