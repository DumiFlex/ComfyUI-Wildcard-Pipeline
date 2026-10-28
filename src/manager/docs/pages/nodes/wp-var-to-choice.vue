<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocUseWhen from "../../../components/docs/DocUseWhen.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocImage from "../../../components/docs/DocImage.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
import VarToken from "../../../components/docs/VarToken.vue";

const controls = [
  { term: "context (in)", desc: "The Context that holds the $variable." },
  { term: "var_name", desc: "The $variable to read. The list shows every variable the wired Context has." },
  { term: "match", desc: "How close the text must be to an option: exact, loose (the default) or closest. See below." },
  { term: "fallback", desc: "A dropdown of the options of the input it's wired into, filled when you connect it. Used when nothing matches or the variable is empty. (first option) means the first option in the list." },
  { term: "if_no_match", desc: "use fallback carries on with the fallback and warns you. stop the run stops here and lists some of the options." },
  { term: "choice (out)", desc: "Wire it into a dropdown input: ckpt_name, sampler_name, scheduler, vae_name, lora_name and so on. The line under the picker names what it feeds and how many options that has." },
];
</script>

<template>
  <DocPage
    group="Nodes"
    title="WP Var → Choice"
    icon="pi pi-list"
    tone="node"
    node-id="WP_VarToChoice"
    blurb="Send a $variable into a dropdown input, such as the checkpoint or the sampler, so a wildcard can pick the model."
  >
    <DocSection title="What it's for">
      <p>
        <b>WP Var → Choice</b> sends a pick into any dropdown: the checkpoint, the sampler, the
        scheduler, the VAE or a LoRA name. It reads the real list of the dropdown it's wired into
        and finds the option your text names, so <VarToken>wai nsfw v14</VarToken> finds
        <code>illustrious/waiNSFW_v14.safetensors</code>. A wildcard of model names can then pick
        the model per image, or per frame in a Context Loop.
      </p>
      <DocImage
        src="images/docs/wp-var-to-choice.png"
        ratio="1720 / 752"
        caption="WP Var → Choice reads $checkpoint and sends the matching file to Load Checkpoint."
      />
    </DocSection>

    <DocSection title="When to use it">
      <DocUseWhen
        :good="[
          'A pick that chooses the checkpoint, sampler, scheduler, VAE or LoRA',
          'Trying several models in one loop: a wildcard of model names, one per frame',
        ]"
        :better="[
          'Text that should stay in the prompt',
          'A number (steps, size): use WP Var → Int or Float',
        ]"
      />
      <DocCallout variant="tip">
        Hide the variable it reads (the globe on its row), so the model name doesn't print in the
        prompt. Add <b>WP Model Info</b> after the loader and your rules can see which model was
        picked.
      </DocCallout>
    </DocSection>

    <DocSection title="Controls">
      <DocKeyList :items="controls" />
    </DocSection>

    <DocSection title="How it matches">
      <ul>
        <li><b>exact</b>: the text must be an option, letter for letter.</li>
        <li>
          <b>loose</b>: capitals, folders, the file extension, spaces, <code>_</code>,
          <code>-</code> and <code>.</code> don't matter, so <VarToken>Euler A</VarToken> finds
          <code>euler_ancestral</code>. If that finds nothing, it takes the shortest option that
          starts with your text, then one that contains it, so <VarToken>dpmpp 2m</VarToken> finds
          <code>dpmpp_2m</code> and not <code>dpmpp_2m_sde</code>.
        </li>
        <li><b>closest</b>: loose, and then the most similar option, so a typo like <VarToken>dreamshapr</VarToken> still lands.</li>
      </ul>
      <p>
        After a run the picker shows what it sent and how it found it. When it used the fallback,
        the line turns amber and a warning pops up.
      </p>
      <DocCallout variant="warn">
        Without this node ComfyUI doesn't check text that comes in through a wire: a name that
        isn't in the list only fails inside the loader. WP Var → Choice checks it first.
      </DocCallout>
      <DocCallout variant="tip">
        Wired into a switch or another node without a list, the text passes through unchecked and
        the picker says so.
      </DocCallout>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'wp-model-info', label: 'WP Model Info', icon: 'pi pi-microchip', tone: 'node' },
          { id: 'wp-context-loop', label: 'WP Context Loop', icon: 'pi pi-replay', tone: 'node' },
          { id: 'wp-var-to-int', label: 'WP Var → Int', icon: 'pi pi-hashtag', tone: 'node' },
          { id: 'wp-var-to-bool', label: 'WP Var → Bool', icon: 'pi pi-check-square', tone: 'node' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
