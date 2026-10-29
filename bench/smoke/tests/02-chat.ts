// Chat: one message per test, on the fake model with the model's answer scripted, so each test
// knows exactly which card it should get and what Apply and Undo must do to the library.
import type { Helpers } from "watchwright";
import { check, fakeLog, lastReply, moduleById, noAiError, optionTexts, script, smoke, snapshot } from "../smoke.js";

const WEATHER = "b0000006";
const SECTION = "Chat";

/** Sends `text` in a new chat and keeps the turn. */
async function send(h: Helpers, text: string): Promise<void> {
  await h.step("send", async () => {
    await h.chat(text);
    await h.chatShot("turn");
  });
}

/** Changes the AI settings, then reloads: the open page keeps the settings it read at load. */
async function settings(h: Helpers, patch: Record<string, unknown>): Promise<void> {
  await h.step("settings", async () => {
    await h.setAiConfig(patch);
    await h.visit("wildcards");
  });
}

smoke(
  "C1",
  { title: "A plain reply shows", section: SECTION, scripted: true, description: "The model's text reply appears in the chat as the assistant's message." },
  async ({ h }) => {
    await script(h, { text: "Hello from the smoke test." });
    await send(h, "Say hello.");
    const reply = await lastReply(h);
    check(h, reply.includes("Hello from the smoke test."), "no-answer", `the reply reads "${reply.slice(0, 120)}"`);
    await noAiError(h);
  },
);

smoke(
  "C2",
  {
    title: "Create card: Apply, then Undo",
    section: SECTION,
    scripted: true,
    tags: ["changes-library"],
    description: "A create_wildcard call becomes a card; Apply adds the wildcard with its options, Undo leaves the library as it was.",
  },
  async ({ h }) => {
    const before = await snapshot(h);
    await script(h, {
      calls: [
        {
          tool: "create_wildcard",
          args: { name: "Smoke colours", var: "smoke_colour", options: [{ text: "crimson" }, { text: "teal" }, { text: "amber", weight: 2 }] },
        },
      ],
    });
    await send(h, "Make a wildcard of three colours.");
    const card = h.page.locator('[data-test="ai-chat"] [data-test="ai-chat-proposal"]').last();
    check(h, await card.isVisible().catch(() => false), "no-card", "a proposal card shows");
    const cardText = (await card.innerText().catch(() => "")) ?? "";
    check(h, /Smoke colours/.test(cardText) && /crimson/.test(cardText), "wrong-card", "the card names Smoke colours and shows its options");
    await h.step("apply", async () => {
      await h.step("apply", () => h.applyCard());
      await h.snap("applied", '[data-test="ai-chat"]');
    });
    const made = (await h.library()).modules.find((m) => m.name === "Smoke colours");
    const options = made ? optionTexts(await moduleById(h, made.id)) : [];
    check(h, !!made && ["crimson", "teal", "amber"].every((o) => options.includes(o)), "apply-did-nothing", `Apply made Smoke colours with ${options.length} option(s)`);
    await h.step("undo", () => h.undoCard());
    check(h, (await snapshot(h)) === before, "undo-left-changes", "Undo left the library exactly as before");
    await noAiError(h);
  },
);

smoke(
  "C3",
  {
    title: "Edit card: add options, Apply, Undo",
    section: SECTION,
    scripted: true,
    tags: ["changes-library"],
    description: "An add_options call on Weather becomes a change card; Apply adds the option, Undo takes it out again.",
  },
  async ({ h }) => {
    const before = await snapshot(h);
    await script(h, { calls: [{ tool: "add_options", args: { id: "Weather", options: [{ text: "smoke test haze" }] } }] });
    await send(h, "Add a hazy option to Weather.");
    await h.step("apply", () => h.applyCard());
    const options = optionTexts(await moduleById(h, WEATHER));
    check(h, options.includes("smoke test haze"), "apply-did-nothing", `Weather has ${options.length} options after Apply`);
    await h.step("undo", () => h.undoCard());
    check(h, (await snapshot(h)) === before, "undo-left-changes", "Undo left the library exactly as before");
    await noAiError(h);
  },
);

smoke(
  "C4",
  {
    title: "Deleting is refused while it's off",
    section: SECTION,
    scripted: true,
    description: "With “Let the assistant delete items” off, a delete_items call deletes nothing and offers no Delete button.",
  },
  async ({ h }) => {
    await settings(h, { allow_delete: false });
    const before = await snapshot(h);
    await script(h, { calls: [{ tool: "delete_items", args: { items: ["Weather copy"] } }] });
    await send(h, "Delete Weather copy.");
    check(h, !(await h.shows("ai-chat-delete")), "deleted-while-off", "no Delete button on the card");
    check(h, (await snapshot(h)) === before, "deleted-while-off", "the library didn't change");
  },
);

smoke(
  "C5",
  {
    title: "Delete card: confirm, then Undo",
    section: SECTION,
    scripted: true,
    tags: ["changes-library"],
    description: "With deleting on, a delete_items call shows a Delete card; confirming deletes Weather copy, Undo brings it back as it was.",
  },
  async ({ h }) => {
    await settings(h, { allow_delete: true });
    try {
      const before = await snapshot(h);
      await script(h, { calls: [{ tool: "delete_items", args: { items: ["Weather copy"] } }] });
      await send(h, "Delete Weather copy.");
      check(h, await h.shows("ai-chat-delete"), "no-card", "a Delete card shows");
      await h.step("apply", () => h.applyCard());
      const gone = !(await h.library()).modules.some((m) => m.name === "Weather copy");
      check(h, gone, "apply-did-nothing", "Weather copy is deleted");
      await h.step("undo", () => h.undoCard());
      check(h, (await snapshot(h)) === before, "undo-left-changes", "Undo brought Weather copy back exactly");
    } finally {
      await h.setAiConfig({ allow_delete: false });
    }
  },
);

smoke(
  "C6",
  { title: "A mention reaches the model", section: SECTION, scripted: true, description: "An @Weather picked from the menu goes to the model with the message." },
  async ({ h }) => {
    await script(h, { text: "Weather is a wildcard." });
    await send(h, "What does @Weather do?");
    const asked = (await fakeLog(h)).map((c) => c.user).join("\n");
    check(h, /Weather|b0000006/.test(asked), "no-answer", "the model's request names Weather");
    await h.snap("chips", '[data-test="ai-chat"]');
    await noAiError(h);
  },
);

smoke(
  "C7",
  {
    title: "Questions, then Decide for me",
    section: SECTION,
    scripted: true,
    description: "An ask call shows its questions with choices; Decide for me sends the turn on, and it ends with a reply.",
  },
  async ({ h }) => {
    await script(
      h,
      { calls: [{ tool: "ask", args: { questions: [{ header: "Style", question: "Which style should it use?", choices: ["Anime", "Photo"] }] } }] },
      { text: "Going with Anime." },
    );
    await send(h, "Make me something.");
    check(h, await h.shows("ai-ask-decide"), "no-card", "the questions show with Decide for me");
    check(h, (await h.page.locator('[data-test="ai-ask-choice"]:visible').count()) >= 2, "wrong-card", "both choices show");
    await h.step("decide for me", async () => {
      await h.answerAsk();
      await h.chatShot("decided");
    });
    check(h, (await lastReply(h)).includes("Going with Anime."), "no-answer", "the turn went on to the reply");
    await noAiError(h);
  },
);

smoke(
  "C8",
  { title: "Open goes to the item", section: SECTION, scripted: true, description: "An open call on Weather opens its editor." },
  async ({ h }) => {
    await script(h, { calls: [{ tool: "open", args: { id: "Weather" } }] }, { text: "Here it is." });
    await send(h, "Open Weather.");
    await h.wait(1500);
    check(h, h.page.url().includes(`/wildcards/${WEATHER}`), "no-answer", `the page is ${h.page.url()}`);
    await h.snap("opened");
  },
);

smoke(
  "C9",
  {
    title: "A real model answers a question",
    section: SECTION,
    description: "Unscripted: whatever model is set up answers a short how-to question with some text and no error.",
  },
  async ({ h }) => {
    await send(h, "In one sentence: what is a wildcard in this app?");
    const reply = await lastReply(h);
    check(h, reply.length > 0, "no-answer", `the reply has ${reply.length} characters`);
    await noAiError(h);
  },
);
