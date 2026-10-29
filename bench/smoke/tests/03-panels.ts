// Editor panels: every editor's AI panel once. On the fake model a panel whose answer is checked
// against the library gets a scripted answer that is valid for it (the rest take the fake's
// sample answer); on a real model it answers for itself. Each test checks that the panel answers,
// offers the answer to apply, and puts it into the editor. Nothing is saved except in E1, which
// deletes what it made.
import { PANEL, type ItemKind } from "../../bench.js";
import { check, noAiError, script, smoke } from "../smoke.js";
import type { Helpers } from "watchwright";

const SECTION = "Editor panels";

/** The open panel's button that applies its answer: Apply, a draft's Add, or an edit's Apply. */
const APPLY = ["ai-apply", "ai-draft-add", "ai-edit-apply"];

async function applyButton(h: Helpers): Promise<string | null> {
  for (let i = 0; i < 10; i++) {
    for (const b of APPLY) if (await h.shows(b)) return b;
    await h.wait(500);
  }
  return null;
}

/** Asks an item's AI panel, checks it answered, then applies the answer to the editor (unsaved). */
async function ask(h: Helpers, kind: ItemKind, name: string, button: string, prompt: string, mode?: string): Promise<void> {
  await h.step("ask", async () => {
    await h.open(kind, name);
    await h.panel(button, { mode, prompt });
    await h.keep("answer", PANEL);
    await h.panelShot("answer");
  });
  const apply = await applyButton(h);
  check(h, !!apply, "no-answer", `the ${mode ?? button} panel shows an answer to apply`);
  await noAiError(h);
  if (apply) {
    await h.step("apply", async () => {
      await h.tap(apply);
      await h.wait(800);
      await h.snap("applied");
    });
    await noAiError(h);
  }
}

smoke(
  "E1",
  {
    title: "New wildcard from the draft panel, saved",
    section: SECTION,
    tags: ["changes-library"],
    description: "Wildcards › New › AI › Add: the drafted options go into a new wildcard that saves. The test deletes it again.",
  },
  async ({ h }) => {
    await h.step("ask", async () => {
      await h.visit("wildcards/new");
      await h.panel("wc-ai-draft", { mode: "add", prompt: "6 hairstyles for fantasy characters" });
      await h.panelShot("answer");
    });
    check(h, await h.shows("ai-draft-add", 5000), "no-answer", "the draft shows options to add");
    await h.step("add and save", async () => {
      await h.tap("ai-draft-add");
      await h.setVar("smoke_hair");
      await h.setName("Smoke hairstyles");
      await h.saveItem();
    });
    const made = (await h.library()).modules.find((m) => m.name === "Smoke hairstyles");
    check(h, !!made, "apply-did-nothing", "Smoke hairstyles is in the library");
    if (made) await h.api(`/wp/api/modules/${made.id}`, { method: "DELETE" });
    await noAiError(h);
  },
);

interface Panel {
  id: string;
  title: string;
  kind: ItemKind;
  name: string;
  button: string;
  prompt: string;
  mode?: string;
  /** The fake model's answer, valid for this item (option numbers count from 1). */
  answer?: unknown;
}

const panels: Panel[] = [
  { id: "E2", title: "Wildcard: add options", kind: "wildcards", name: "Outfit", button: "wc-ai-draft", mode: "add", prompt: "5 more outfits for a fantasy adventurer" },
  { id: "E3", title: "Wildcard: remove options", kind: "wildcards", name: "Outfit", button: "wc-ai-draft", mode: "remove", prompt: "remove the modern clothes", answer: { remove: [{ id: 10, reason: "modern streetwear" }] } },
  { id: "E4", title: "Wildcard: rewrite options", kind: "wildcards", name: "Outfit", button: "wc-ai-draft", mode: "rewrite", prompt: "make the first option more vivid", answer: { options: [{ id: 1, text: "faded denim jacket over a crisp white t-shirt" }] } },
  { id: "E5", title: "Wildcard: retag options", kind: "wildcards", name: "Outfit", button: "wc-ai-draft", mode: "retag", prompt: "tag the first option formal", answer: { options: [{ id: 1, tags: ["formal"] }] } },
  { id: "E6", title: "Wildcard: reweight options", kind: "wildcards", name: "Outfit", button: "wc-ai-draft", mode: "reweight", prompt: "make the chainmail rarer", answer: { options: [{ id: 6, weight: 0.2 }] } },
  { id: "E7", title: "Describe an item", kind: "wildcards", name: "Weather", button: "identity-ai", prompt: "" },
  { id: "E8", title: "Fixed values panel", kind: "fixed-values", name: "Anime style", button: "fv-ai", prompt: "add a soft lighting line", answer: { values: [{ name: "lighting", value: "soft diffused lighting", negative: "" }] } },
  { id: "E9", title: "Combine panel", kind: "combines", name: "Character phrase", button: "cb-ai", prompt: "put the mood first" },
  {
    id: "E10",
    title: "Derivation panel",
    kind: "derivations",
    name: "Light from weather",
    button: "drv-ai",
    prompt: "cold blue light when it snows",
    answer: { rules: [{ edits: 1, summary: "cold light in snow", branches: [{ match: "all", conditions: [{ var: "weather", op: "contains", value: "snow" }], actions: [{ target_var: "light", mode: "replace", value: "cold blue light" }] }], else_actions: [] }] },
  },
  { id: "E11", title: "Constraint panel", kind: "constraints", name: "Race → class", button: "cn-ai", prompt: "orcs are never mages", answer: { rules: [{ source: "orc", target: "mage", effect: "exclude", factor: 0, reason: "orcs don't study magic" }] } },
  { id: "E12", title: "Template panel", kind: "templates", name: "Bench portrait", button: "tpl-ai", prompt: "add the weather at the end" },
];

for (const p of panels) {
  smoke(p.id, { title: p.title, section: SECTION, description: `${p.name} › AI${p.mode ? ` › ${p.mode}` : ""}: the panel answers, the answer applies to the editor, and no AI error shows. Nothing is saved.` }, async ({ h, params }) => {
    if (params.fake === true && p.answer !== undefined) await script(h, { json: p.answer });
    await ask(h, p.kind, p.name, p.button, p.prompt, p.mode);
  });
}

smoke(
  "E13",
  { title: "Bundle split suggestion", section: SECTION, description: "Bench character › Split › Suggest: the dialog shows a suggestion and no error." },
  async ({ h }) => {
    const text = await h.step("suggest", async () => {
      await h.open("bundles", "Bench character");
      await h.tap("bd-split-btn", { done: () => h.shows("split-suggest") });
      await h.tap("split-suggest", { done: () => h.busy() });
      await h.aiIdle({ expect: true });
      const answer = await h.keep("answer", '[role="dialog"]');
      await h.snap("answer", '[role="dialog"]');
      return answer;
    });
    check(h, text.trim().length > 0, "no-answer", "the split dialog shows text");
    await noAiError(h);
    await h.page.keyboard.press("Escape");
  },
);

smoke(
  "E14",
  { title: "Organize with AI", section: SECTION, description: "Wildcards › select all › Organize with AI: the panel answers with changes to apply. Nothing is applied." },
  async ({ h }) => {
    await h.step("organize", async () => {
      await h.visit("wildcards");
      await h.tap('[aria-label="Select all"]');
      await h.tap("bulk-ai-organize");
      await h.panel("bulk-ai-organize", { prompt: "file each into the right category" });
      await h.keep("answer", PANEL);
      await h.panelShot("answer");
    });
    check(h, await h.shows("ai-apply", 5000), "no-answer", "Organize shows changes to apply");
    await noAiError(h);
  },
);
