<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import DocKeyList from "../../../components/docs/DocKeyList.vue";
import DocDetails from "../../../components/docs/DocDetails.vue";
import DocRef from "../../../components/docs/DocRef.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";
</script>

<template>
  <DocPage
    group="AI assistant"
    title="Chat"
    icon="pi pi-comments"
    tone="neutral"
    blurb="Ask about your library or the docs, or ask for a change. Every change comes back as a card you apply, dismiss or undo."
  >
    <DocSection title="Ask anything">
      <p>
        Press <b>AI</b> in the top bar to open the chat. Some things to try:
      </p>
      <ul>
        <li>"Which wildcards set $outfit?"</li>
        <li>"What's missing for a fantasy pack?"</li>
        <li>"Make my Weather wildcard gloomier."</li>
        <li>"Why does wool coat never come up?"</li>
        <li>"Where do I set the context size?"</li>
      </ul>
      <p>
        The assistant searches and reads your items and these docs by itself; the lines above each
        reply say what it looked at. It also sees the page you're on: in an editor it reads the item
        as it is now, unsaved changes included, so "this wildcard" means what you see.
      </p>
      <p>
        A new chat offers a few starter questions that fit the page you're on. <b>What can you
        do?</b> lists the rest.
      </p>
    </DocSection>

    <DocSection title="Point at things with @">
      <p>
        Type <b>@</b> and a few letters to pick a wildcard, module or bundle, so "add more options
        to @Hairstyle" can't land on a look-alike. Type <b>$</b> for a variable. With tag and model
        completion on, a few letters also offer Danbooru tags, LoRAs and embeddings. This works in
        the chat box, every Draft with AI box and the Pack builder.
      </p>
      <p>
        A picked item shows as a chip in the box while you type, so you can see it will go as that
        exact item. A name you type yourself without picking it stays plain text and goes as words.
        Pick a wildcard and ask for a "reference" or a "nested" pick of it, and the assistant puts
        <code>@{Name}</code> in the new options; if it leaves that out, it is told and fixes it
        before it answers.
      </p>
    </DocSection>

    <DocSection title="When it asks you first">
      <p>
        If a request could go several ways (a style, how many, which item), the assistant asks up to
        four short questions with answers to click. Pick one, type your own under <b>Other…</b>, or
        press <b>Decide for me</b>. With several questions, press <b>Send answers</b>. It remembers
        your answers for the rest of the chat.
      </p>
    </DocSection>

    <DocSection title="Cards: how changes reach your library">
      <p>
        The assistant only ever proposes. Every change is a card, and nothing happens until you
        press <b>Apply</b>.
      </p>
      <DocKeyList
        :items="[
          { term: 'Apply', desc: 'Makes the change. A change to the item open in your editor goes into the editor; keep it with Save there. Other changes save to the library.' },
          { term: 'Undo', desc: 'Puts back what the card replaced, or deletes what it created.' },
          { term: 'Dismiss', desc: 'Tells the assistant you said no.' },
          { term: 'Open in editor', desc: 'On a new item: fills the editor with it so you can change things before you save.' },
          { term: 'Apply all', desc: 'On a card that needs others first (a constraint between two new wildcards): applies them in order.' },
          { term: 'Magnifier', desc: 'Opens the whole card in a larger window.' },
        ]"
      />
      <p>
        A card draws the change the way its editor shows the item. A wildcard change lists the
        options it touches: <b>+</b> for a new one, struck through for a removed one, and old → new
        for a changed text, share of the draw, tag, negative or fallback. The options it leaves
        alone fold into "N unchanged"; the magnifier lists them too. A change to an item's
        description, tags, category or rating shows each as old → new, with the category's own
        chip. Category, tag and bulk cards show the chips you see in the library. A derivation
        change shows its IF / ELIF / ELSE blocks with the changed branches marked (a dropped ELSE
        struck through, an added action with <b>+</b>), a constraint change marks the changed cells
        of its grid and its changed exceptions, and a bundle change lists its items in order with
        <b>+</b> added, struck through removed, <b>↕</b> moved (from its old place), on → off and
        use settings old → new. A fixed values change shows its Variable / Value / Negative table
        with the changed cells old → new, a template or combine change marks the words it adds and
        drops along with the variables it now reads or no longer reads, and a delete card lists
        what goes with its category chip and rating, how many items a dropped category or tag
        leaves, and that Undo makes them again. Parts a change leaves alone fold into "N unchanged".
      </p>
      <p>
        Three or more cards of one kind come as one <b>group card</b> with a row per item. Untick
        the rows you don't want and press <b>Apply</b>. <b>Undo all</b> takes them all back.
      </p>
      <p>
        Every card is checked before you see it, and warns about things like a wildcard that mixes
        two subjects, repeated options, or a constraint that can leave a wildcard empty. A warning
        with <b>Fix it</b> (for example <b>Merge the repeats</b> or <b>Even out the weights</b>)
        fixes the card in place; <b>Fix all</b> runs every one. <b>Ask to fix</b> asks the assistant
        for a corrected card.
      </p>
    </DocSection>

    <DocSection title="What it can change">
      <ul>
        <li>Create wildcards (with tag groups, negatives, an empty option, a fallback and references),
          or change one: add, remove, rewrite, retag, re-weight and reorder options, set negatives,
          pick the fallback, rename its variable.</li>
        <li>Create or change fixed values, combines and prompt templates.</li>
        <li>Create derivations, and add, replace, move or remove rules, including AND / OR tests.</li>
        <li>Create constraints, or change their rules, their reach, or the wildcard on either side.</li>
        <li>Create bundles in the right running order with per-use settings, and group a pack into
          sub-bundles.</li>
        <li>Change descriptions, tags, categories and ratings, find duplicates, and tell you what
          reads a variable before you rename it.</li>
        <li>Make or rename categories and rename library tags everywhere. Each is a card with Undo.</li>
        <li>Hand a whole new pack to the <DocRef id="ai-pack-builder" /> with <b>Open in Pack
          builder</b>. It fills in the description and the settings the chat recommends, then waits
          for you to add images and press <b>Plan it</b>.</li>
      </ul>
      <p>
        It only changes items you named, have open, or that its last answer showed you. Asked for
        something new, it makes a new item instead of rewriting yours.
      </p>
      <p>
        Adding a tag to options keeps the tags they have. A card that takes a tag off every option
        while a constraint still has rules for it says so, since those rules would stop working.
        Asked to draft options in a wildcard's panel, it passes on how many you asked for.
      </p>
    </DocSection>

    <DocSection title="It can show you around and test its work">
      <ul>
        <li><b>Show you around.</b> It opens an editor, a docs page or a Settings section, and points
          at the part you asked about with an outline and a caption. Esc or a click closes it. On a
          list it can select rows for you.</li>
        <li><b>Use the page's AI tools.</b> It can open an item and ask its Describe or Draft with AI
          panel for you, open <b>Organize with AI</b> on the rows it means, or set up and run the
          Test Runner. You review the result there as usual.</li>
        <li><b>Run a stack on the engine.</b> Before it answers, it can run modules from your
          library and report what moves ("wool coat 40% → 0%"). Running changes nothing in your
          library. The run shows as a card with <b>Open in Test Runner</b>.</li>
      </ul>
    </DocSection>

    <DocSection title="Images">
      <p>
        With a model that sees images (Gemma 3, Qwen2.5-VL, Llama 3.2 Vision, Claude, GPT-4o and
        others), attach up to 4 images: the image button, paste, or drop them on the chat. Try
        <b>Make wildcards from this image</b>: the assistant describes the subject, clothing, pose,
        setting, lighting, style and camera, and proposes wildcards from them.
      </p>
      <p>
        Images are shrunk to at most 1568 pixels on the long side and saved again as JPEG, which
        drops camera details and location. The model sees the newest 8 images of a chat. If your
        server says the model can't see images, the image button is off.
      </p>
    </DocSection>

    <DocSection title="Ask about a test run or the docs">
      <p>
        After a run in the <b>Test Runner</b>, the bar above the results offers <b>Explain this
        run</b>, <b>Fix the warnings</b> and <b>Why do I never get…</b>. The assistant runs the
        scenario again itself to check its answer and offers fixes as cards.
      </p>
      <p>
        It answers questions about Wildcard Pipeline from these docs and names the page it used. It
        doesn't guess: if the docs don't cover something, it says so. On any docs page, <b>Ask about
        this page</b> (top right, it stays there as you scroll) puts a question naming the page in
        the chat box, so it still asks about that page if you move on before sending.
      </p>
      <p>
        Select text anywhere in the manager and a small bar appears: <b>Explain</b> sends it to the
        chat, <b>Ask</b> quotes it in the message box. <code>Ctrl+Shift+X</code> explains the
        selection directly. Turn the bar off with <b>Settings › AI assistant › Show Explain on
        selected text</b>.
      </p>
    </DocSection>

    <DocSection title="Using the chat">
      <DocKeyList
        :items="[
          { term: 'Stop', desc: 'Ends the answer.' },
          { term: 'Try again', desc: 'Asks the same message again; the new answer replaces the old one. It waits until you undo changes you applied from that answer.' },
          { term: 'Edit', desc: 'The pencil on your last message puts it back in the box to change and send again (Esc cancels).' },
          { term: 'Copy', desc: 'Copies an answer as Markdown.' },
          { term: 'Time', desc: 'Beside Copy, how long the answer took. Time spent waiting on you (a question, a web search to allow) is left out.' },
          { term: 'Chats', desc: 'Your saved chats, newest first, with search. Rename, pin or delete each. ComfyUI keeps the newest 100 plus every pinned one.' },
          { term: 'New chat', desc: 'Starts over with an empty box.' },
          { term: 'Model menu', desc: 'The model name in the header: switch models from the next message on. If the new model can\'t carry on, start a new chat.' },
          { term: 'Width', desc: 'Drag the chat\'s left edge (or focus it and use the arrow keys). Double-click to reset.' },
          { term: 'Context bar', desc: 'How much of the model\'s memory the chat uses. Past three quarters, older messages are summarised into a short note; Compact does it now.' },
        ]"
      />
      <p>
        While it works, a line shows what the model is doing (reading, thinking, writing) and for
        how long; the same line shows in the top bar on every page. What it writes between steps
        folds into a <b>Working note</b>, and a thinking model's reasoning folds into
        <b>Thinking</b>. To see only replies and cards, turn off <b>Show thinking</b>, <b>Show
        working notes</b> or <b>Show what it did</b> under <b>Settings › AI assistant › Chat</b>.
        The reply arrives whole when it is done; turn on <b>Type out replies</b> there to watch it
        appear word by word instead (and the Thinking box fill as the model thinks). When nothing
        has come back for ten seconds the line says so: the model may be busy with another
        request (LM Studio answers one at a time unless its model allows more in parallel),
        still loading, or reading a long prompt. The server can't tell which.
      </p>
      <p>
        A thanks or a 👍 gets an emoji reaction straight away, without asking the model. If you
        delete an item the answer mentioned, its chip is struck through.
      </p>
      <DocCallout variant="tip">
        Chat works best with a model that follows instructions well. A small model may need a
        second try or a more specific request; see <DocRef id="ai-troubleshooting" />.
      </DocCallout>
    </DocSection>

    <DocSection title="Good to know">
      <DocDetails>
        <p>
          <b>Replies.</b> Replies use Markdown: headings, lists, tables, quotes and code blocks with
          a copy button. Prompt syntax is coloured like in the editors: a variable in its own
          colour with <code>.0</code> / <code>.SHOES</code> in amber and <code>.neg</code> in red,
          and a variable the run sets (<code>$iteration</code>, <code>$model_family</code> and the
          other WP Model Info ones) underlined dotted, since rules can read it but nothing writes it.
          Every item it mentions is a chip you can click, also when the model wrote the name in
          backticks, and a list of three or more items shows as an item list with each item's
          category. Lines starting "Tip:" or "Warning:" (or a GitHub-style
          <code>[!NOTE]</code> alert) stand out. Links show as text and are never opened. Code blocks
          over 20 lines are folded.
        </p>
        <p>
          <b>Finding the right item.</b> Before the model answers, the chat searches your library
          for what your message is about and hands it the clear matches, so "make the outfit
          wildcard warmer" starts from the right item. The search reads option texts, values and
          rules, not only names, and broad subjects widen ("characters" also finds hair and eye
          wildcards). It runs on a full-text index, so it stays quick with thousands of items. A
          how-to question also gets pointers to the matching docs sections.
        </p>
        <p>
          <b>Which items it may change.</b> Items you named ("add rain to my Weather", a chip), the
          one you have open, ones its last answer showed you as a chip, or ones it read in full for
          your request. When several share a name, the one you named or it already read is meant.
          Options a constraint points at are never removed this way. If you edit an item after
          asking, its card says it's out of date. A card made before the item changed is blocked,
          so it can't undo the newer change.
        </p>
        <p>
          <b>Cards.</b> A new item's card already carries its future id, so cards that point at it
          are linked from the start. Several changes to one item come as one <b>Change</b> card
          with one Apply and one Undo. Deletes, links and library-wide changes stay single cards. A
          card shows its first lines with "+N more"; the magnifier shows all of it. Grey notes only
          tell you something and have no button.
        </p>
        <p>
          <b>Keeping it honest.</b> The assistant tests module changes before it answers, so the
          reply says what the change does. An answer that claims something was made or tested
          with no call behind it, puts part of your request off until later, comes back empty or
          garbled, or names a setting or variable that nothing mentions is sent back once to fix
          it. A tool call written as text ("I call: read …") still runs, and the leftovers of a
          JSON step ("calls: []") never show in the reply. It doesn't ask "should I go
          ahead?", since the card is already the asking.
        </p>
        <p>
          <b>Limits.</b> One answer reads about 6 items with a small model, 8 with a medium one and
          12 with a large or cloud one before it must answer. A local model gets up to 20 minutes
          per answer, a cloud model 10. "Cut off" means the model hit its output limit; thinking
          models can spend it all before they answer.
        </p>
        <p>
          <b>Memory.</b> The chat keeps every search, read, test run and card, and is told what you
          did with each card and what changed in your library, so "use the second one" or "undo
          that" works. Each request starts with exactly what the last one sent, so the server can
          reuse what it already read: follow-ups are faster and, on a paid provider, cheaper. In a
          long chat, old tool results shrink and the oldest turns may be left out. The summary is
          written by your own model and kept with the chat. "~" on the context bar means an
          estimate, and "about" means a cloud model's usual size.
        </p>
        <p>
          <b>Questions.</b> Number keys pick in the focused question, and some questions take
          several answers. It asks at most twice per message, then decides and says what it assumed.
        </p>
      </DocDetails>
    </DocSection>

    <DocSection title="Works with">
      <CrossLinks
        :links="[
          { id: 'ai-assistant', label: 'AI assistant', icon: 'pi pi-microchip-ai', tone: 'neutral' },
          { id: 'ai-library', label: 'Organize and import', icon: 'pi pi-folder', tone: 'neutral' },
          { id: 'ai-web', label: 'Web search', icon: 'pi pi-globe', tone: 'neutral' },
          { id: 'test-runner', label: 'Test Runner', icon: 'pi pi-bolt', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>
