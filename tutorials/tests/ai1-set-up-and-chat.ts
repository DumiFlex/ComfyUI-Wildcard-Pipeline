// AI 1: set up and chat. Settings › AI assistant (on, provider, address, model, Test connection), then
// the chat drawer: a request that becomes a card (a new Weather wildcard), Apply and its Undo, and a
// question answered from the docs. Needs a model (the PC's LM Studio).
import { aiWait, tutorial } from "../tutorial.js";

const field = (id: string) => `textarea[data-test="${id}"], [data-test="${id}"] textarea, input[data-test="${id}"], [data-test="${id}"] input`;

tutorial(
  "AI1",
  {
    title: "AI assistant: set up and chat",
    description: "Connect a model, local or in the cloud, and ask the assistant to make and change items: every change comes as a card you apply or not.",
    learn: "Settings › AI assistant, Test connection, the chat drawer, cards, Apply and Undo, asking questions.",
  },
  async (t) => {
    const page = t.page;

    await t.h.step("Connect a model", async () => {
      await t.go("/wp/settings/ai");
      await t.say("The assistant is optional and off until you turn it on. Open Settings, AI assistant.");
      await t.callout("on", page.locator('[data-test="ai-enabled"]'), "On", 3);
      await t.waitVoice();
      await t.uncallout("on");
      await t.callout("who", [page.locator('[data-test="ai-provider"]'), page.locator('[data-test="ai-model"]')], "Where the model runs, and which", 6);
      await t.say("Pick where the model runs: a local server like LM Studio or Ollama, or a cloud provider with a key. Then pick the model. This one is a nine billion parameter model on this PC.");
      await t.waitVoice();
      await t.uncallout("who");
      await t.say("Test connection checks it answers.");
      await t.scrollTo(page.locator('[data-test="ai-test"]'), { at: 0.4 });
      await t.click(page.locator('[data-test="ai-test"]'));
      await aiWait(t, { quiet: 1500 });
      await t.callout("ok", page.locator('[data-test="ai-test-result"]'), "It answers", 4);
      await t.waitVoice();
      await t.uncallout("ok");
      await t.callout("priv", page.locator('[data-test="ai-privacy"]'), "Where your data goes", 4);
      await t.say("This card says where your data goes. With a local model, nothing leaves your PC.");
      await t.waitVoice();
      await t.uncallout("priv");
    });

    await t.h.step("Ask for a change", async () => {
      await t.say("The sparkle at the top opens the chat. Ask for something.");
      await t.click(page.locator('[data-test="topbar-ai"]'));
      await t.beat(800);
      const fresh = page.locator('[data-test="ai-chat-new"]');
      if (await fresh.isEnabled().catch(() => false)) {
        await t.click(fresh);
        await t.beat(500);
      }
      await t.fill(page.locator(field("ai-chat-input")).first(), "Make a wildcard called Weather with sunny, rainy, foggy and snowy.", { cps: 24 });
      await t.click(page.locator('[data-test="ai-chat-send"]'));
      await aiWait(t);
      const card = page.locator('[data-test="ai-chat-proposal"]').last();
      await t.callout("card", card, "A card: nothing changed yet", 6);
      await t.say("The answer is a card. Nothing changes until you apply it, so read it first.");
      await t.waitVoice();
      await t.uncallout("card");
      const apply = page.locator('[data-test="ai-group-apply"]:visible, [data-test="ai-chat-apply-all"]:visible, [data-test="ai-chat-apply"]:visible').last();
      await t.say("Apply makes it.");
      await t.click(apply);
      await t.beat(1500);
      await t.callout("undo", page.locator('[data-test="ai-chat-undo"]:visible, [data-test="ai-group-undo"]:visible').last(), "One click back", 4);
      await t.say("And Undo takes it back, any time.");
      await t.waitVoice();
      await t.uncallout("undo");
    });

    await t.h.step("Ask a question", async () => {
      await t.say("It knows the docs too. Ask how something works.");
      await t.fill(page.locator(field("ai-chat-input")).first(), "What does a constraint do?", { cps: 24 });
      await t.click(page.locator('[data-test="ai-chat-send"]'));
      await aiWait(t);
      await t.callout("ans", page.locator('[data-test="ai-chat-reply"]').last(), "An answer from the docs", 5);
      await t.waitVoice();
      await t.uncallout("ans");
    });

    await t.h.step("Outro", async () => {
      await t.say("Connect a model, ask in plain words, and apply only the cards you like. Next: drafting with AI inside the editors.");
    });
  },
);
