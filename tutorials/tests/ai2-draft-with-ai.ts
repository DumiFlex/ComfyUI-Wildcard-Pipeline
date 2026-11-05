// AI 2: Draft with AI. The Outfit editor's AI button: a request for more options, the answer as a
// preview, Apply into the editor (not saved until Save). Other editors have the same button.
import { aiWait, tutorial } from "../tutorial.js";

const field = (id: string) => `textarea[data-test="${id}"], [data-test="${id}"] textarea, input[data-test="${id}"], [data-test="${id}"] input`;
const PANEL = '[data-test="ai-panel"]:visible, [data-test="ai-draft-panel"]:visible, [data-test="ai-edit-panel"]:visible';

tutorial(
  "AI2",
  {
    title: "AI assistant: draft with AI",
    description: "The AI button in every editor: draft new options, rules or text for the item you're working on, then apply what you like.",
    learn: "The editor's AI panel, asking for options, the preview, Apply into the editor, Save.",
  },
  async (t) => {
    const page = t.page;

    await t.h.step("The AI button", async () => {
      await t.go("/wp/wildcards/195238e2/edit");
      await t.say("Every editor has an AI button. Open Outfit and press it.");
      await t.scrollTo(page.locator('[data-test="wc-ai-draft"]'), { at: 0.35 });
      await t.click(page.locator('[data-test="wc-ai-draft"]'));
      await t.beat(900);
      await t.waitVoice();
    });

    await t.h.step("Ask for options", async () => {
      await t.say("Say what you want. It knows this wildcard's options, so it adds new ones in the same style.");
      await t.fill(page.locator(field("ai-instruction")).first(), "Add four outfits for a fantasy adventure.", { cps: 24 });
      await t.click(page.locator('[data-test="ai-run"]:visible').last());
      await aiWait(t);
      await t.callout("ans", page.locator(PANEL).first(), "New options, not saved yet", 6);
      await t.say("The new options show here first.");
      await t.waitVoice();
      await t.uncallout("ans");
    });

    await t.h.step("Apply, then save", async () => {
      await t.say("Apply puts them in the editor. They're yours to change, and Save keeps them.");
      // The Add panel's button is "Add N options" (ai-draft-add); other panels say ai-apply.
      const apply = page.locator('[data-test="ai-draft-add"], [data-test="ai-apply"]').last();
      await t.scrollTo(apply, { at: 0.6 });
      await t.click(apply);
      await t.beat(1200);
      await t.callout("save", page.locator('[data-test="save-btn"]'), "Nothing is saved until you do", 4);
      await t.waitVoice();
      await t.uncallout("save");
      await t.say("Derivations, constraints, templates and the rest have the same button, each with its own kind of help.");
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Ask in the editor, check the preview, apply and save. Next: building a whole pack.");
    });
  },
);
