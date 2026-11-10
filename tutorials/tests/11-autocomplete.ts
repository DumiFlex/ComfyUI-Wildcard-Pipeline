// Tutorial 11: autocomplete. Every source is off until you turn it on: the Danbooru tag list (one
// download), your LoRAs and your embeddings, each for the manager and the canvas on its own. Then
// the suggestions in a wildcard's options and in an Assembler template. Switched off again at the end
// so the other videos type without a pop-up.
import type { Locator } from "playwright";
import { tutorial, type Tutor } from "../tutorial.js";

/** The switches this video turns on (and off again at the end), as they are shown. */
const SWITCHES = ["settings-tag-autocomplete", "canvas-ac-tags", "settings-lora-autocomplete", "canvas-ac-lora", "settings-autocomplete-spaces", "canvas-ac-spaces"];

async function setSwitch(t: Tutor, sw: Locator, on: boolean): Promise<void> {
  if ((await sw.count()) === 0) return;
  if (((await sw.getAttribute("aria-checked")) === "true") !== on) await t.click(sw);
}

tutorial(
  "T11",
  {
    title: "Autocomplete in every text box",
    description: "Download the Danbooru tag list, turn on tag, LoRA and embedding suggestions for the manager and the canvas, and use them while typing.",
    learn: "Where autocomplete is switched on, the one-time tag download, and the suggestions in options and templates.",
  },
  async (t) => {
    const page = t.page;
    const sw = (id: string) => page.locator(`[data-test="${id}"]`);
    let loras = false;

    await t.h.step("Turn it on", async () => {
      // Off camera: a tag list left from an earlier take would show Replace, not Download.
      await t.h.api("/wp/api/tags", { method: "DELETE" }).catch(() => undefined);
      await t.go("/wp/settings/autocomplete");
      await t.say("Wildcard Pipeline can suggest tags, LoRAs and embeddings while you type. It's all off until you turn it on, here in the manager's Settings, under Autocomplete.");
      await t.waitVoice();
      const download = sw("tagac-download");
      await t.callout("dl", download, "One download, from this project", 6);
      await t.say("Tag suggestions need a tag list first. Download fetches it once, about five megabytes, and nothing else ever goes online.");
      await t.click(download);
      await t.uncallout("dl");
      await page
        .waitForFunction(() => /tags/i.test(document.querySelector('[data-test="tagac-status"]')?.textContent ?? "") && !/no tag list/i.test(document.querySelector('[data-test="tagac-status"]')?.textContent ?? ""), null, { timeout: 120_000 })
        .catch(() => undefined);
      await t.waitVoice();
      await t.callout("status", sw("tagac-status"), "Installed", 4);
      await t.say("Installed, with the number of tags in it.");
      await t.waitVoice();
      await t.uncallout("status");
      await t.say("Each source has two switches. Manager is for these pages, Canvas is for the nodes in ComfyUI. Turn tags on for both.");
      await setSwitch(t, sw("settings-tag-autocomplete"), true);
      await setSwitch(t, sw("canvas-ac-tags"), true);
      await t.waitVoice();
      loras = !/none found/i.test((await sw("lora-count").textContent().catch(() => "")) ?? "");
      if (loras) {
        await t.say("Your installed LoRAs and embeddings work the same way. Turn on LoRAs.");
        await setSwitch(t, sw("settings-lora-autocomplete"), true);
        await setSwitch(t, sw("canvas-ac-lora"), true);
      } else {
        await t.say("Your installed LoRAs and embeddings work the same way, once you have some.");
      }
      await t.waitVoice();
      await t.scrollTo(sw("settings-autocomplete-spaces"), { at: 0.4 });
      await t.say("Below are the details. Write tags with spaces turns blue underscore hair into blue hair, which reads better in a prompt.");
      await setSwitch(t, sw("settings-autocomplete-spaces"), true);
      await setSwitch(t, sw("canvas-ac-spaces"), true);
      await t.waitVoice();
    });

    await t.h.step("While you type", async () => {
      await t.go("/wp/wildcards/new");
      await t.say("Now try it in a new wildcard. Type the start of a tag in an option.");
      const value = (i: number) => page.locator(`[data-test="wc-opt-row-${i}"] .wp-rt__host`).first();
      // High up, so the suggestion list opens above the caption.
      await t.scrollTo(value(0), { at: 0.25, force: true });
      await t.click(value(0));
      await t.type("blue_hai", { cps: 10 });
      await t.beat(600);
      const list = page.getByRole("listbox").last();
      await t.callout("list", list, "Tags, most used first", 6);
      await t.waitVoice();
      await t.say("The list shows how often each tag is used. Arrow keys move, Enter picks.");
      await t.waitVoice();
      await t.uncallout("list");
      await t.press("Enter");
      await t.beat(800);
      await t.click(value(1));
      if (loras) {
        await t.say("Start a LoRA with <lora: and the list shows your LoRAs.", "Start a lora with angle bracket, lora, colon, and the list shows your loras.");
        await t.type("<lora:", { cps: 10 });
        await t.beat(900);
        await t.callout("loras", page.getByRole("listbox").last(), "Your LoRAs", 4);
        await t.waitVoice();
        await t.uncallout("loras");
        await t.press("Enter");
      } else {
        await t.type("long_hai", { cps: 10 });
        await t.beat(600);
        await t.press("Enter");
      }
      await t.beat(800);
      await t.say("This was only a try, so cancel and discard it.");
      await t.click(page.locator('[data-test="cancel-btn"]'));
      await t.beat(600);
      await t.click(page.getByRole("button", { name: "Discard & leave" }));
      await t.waitVoice();
    });

    await t.h.step("On the canvas", async () => {
      await t.go("/");
      await t.say("On the canvas it works in the node text boxes, like an Assembler's template.");
      const asm = await t.addNode("WP Prompt Assembler", { x: 900, y: 300 });
      await t.click(t.node(asm).locator("textarea, [contenteditable='true']").first());
      // Keep the suggestion list open: it's what this step shows.
      await t.type("1girl, red_ey", { cps: 10, rest: false });
      await t.beat(900);
      await t.waitVoice();
      await t.callout("canvas-list", page.getByRole("listbox").last(), "The same suggestions", 6);
      await t.say("The same list, on the node. Enter picks red eyes.");
      await t.waitVoice();
      await t.uncallout("canvas-list");
      await t.press("Enter");
      await t.beat(900);
    });

    await t.h.step("Switch it off", async () => {
      await t.go("/wp/settings/autocomplete");
      await t.say("Don't want the pop-up somewhere? Switch that side off again. I'll turn everything off for the next videos.");
      for (const id of SWITCHES) await setSwitch(t, sw(id), false);
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Download the tag list once, switch on what you want, per side, and the suggestions follow you everywhere you type.");
    });
  },
);
