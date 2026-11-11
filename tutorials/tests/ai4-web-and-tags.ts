// AI 4: web search and tag lookup. Settings › AI assistant: a search engine (SearXNG or a key), the
// live Danbooru lookup (shown, left off), "Don't ask before web calls" left off, the delete and
// auto-apply permissions. Then the tag lookup that needs no web: Settings › Autocomplete's tag list
// with Booru tags on (on here, back as it was at the end), and a chat ask that finds a tag in it.
// (The live Danbooru lookup is refused by Cloudflare from the recording PC's network.)
import type { Locator } from "playwright";
import { StepError } from "watchwright";
import { aiWait, tutorial, type Tutor } from "../tutorial.js";

async function setSwitch(t: Tutor, sw: Locator, on: boolean): Promise<void> {
  if ((await sw.count()) === 0) return;
  if (((await sw.getAttribute("aria-checked")) === "true") !== on) await t.click(sw);
}

const field = (id: string) => `textarea[data-test="${id}"], [data-test="${id}"] textarea, input[data-test="${id}"], [data-test="${id}"] input`;

tutorial(
  "AI4",
  {
    title: "AI assistant: web search and tag lookup",
    description: "Let the assistant search the web, always after you allow it, look tags up in your own tag list, and choose what else it may do.",
    learn: "Search engine settings, the Danbooru lookup, Allow before each web call, delete and auto-apply permissions, tag lookup from the Autocomplete tag list.",
  },
  async (t) => {
    const page = t.page;
    const danbooru = page.locator('[data-test="ai-danbooru"]');
    const isOn = async () => (await danbooru.getAttribute("aria-checked").catch(() => null)) === "true" || (await danbooru.locator("input").isChecked().catch(() => false));
    const tagSwitch = page.locator('[data-test="settings-tag-autocomplete"]');
    let tagsWereOn = false;

    await t.h.step("Web settings", async () => {
      await t.go("/wp/settings/ai");
      // A take that stopped halfway can leave the lookup on; switch it off out of the video so
      // this one shows turning it on.
      if (await isOn()) {
        await t.fastForward(async () => {
          await danbooru.scrollIntoViewIfNeeded();
          await danbooru.click();
          await page.waitForTimeout(600);
          await page.evaluate(() => window.scrollTo(0, 0));
        }, 0);
      }
      await t.say("Web tools are off until you set them up, in Settings, AI assistant.");
      await t.scrollTo(page.locator('[data-test="ai-search-engine"]'), { at: 0.3 });
      await t.callout("eng", page.locator('[data-test="ai-search-engine"]'), "Your own SearXNG, or a search key", 5);
      await t.say("Web search uses a search engine you choose: your own SearXNG, or a provider with a key.");
      await t.waitVoice();
      await t.uncallout("eng");
      await t.scrollTo(danbooru, { at: 0.4 });
      await t.callout("dan", danbooru, "Live Danbooru, also after Allow", 5);
      await t.say("Danbooru lookup reads tags, their wiki and related tags online. Read only, and never more than one call a second. For plain tag names you don't need it, as you'll see.");
      await t.waitVoice();
      await t.uncallout("dan");
      await t.callout("ask", page.locator('[data-test="ai-web-always"]'), "Leave this off: it asks first", 5);
      await t.say("Every web call waits for your Allow. This switch would skip that; leave it off.");
      await t.waitVoice();
      await t.uncallout("ask");
      await t.scrollTo(page.locator('[data-test="ai-allow-delete"]'), { at: 0.4 });
      await t.callout("perm", [page.locator('[data-test="ai-allow-delete"]'), page.locator('[data-test="ai-auto-apply"]')], "Off unless you want them", 5);
      await t.say("Two more permissions, both off: letting it delete items, and applying small safe changes without a card.");
      await t.waitVoice();
      await t.uncallout("perm");
    });

    await t.h.step("Your own tag list", async () => {
      // Off camera: the tag list must be there (the Autocomplete video downloads it on camera).
      const status = await t.h.api("/wp/api/tags/status");
      const have = !!((status.json?.data ?? status.json) as { available?: unknown } | undefined)?.available;
      if (!have) {
        await t.fastForward(async () => {
          const r = await t.h.api("/wp/api/tags/download", { method: "POST" });
          if (!r.ok) throw new StepError("The tag list couldn't be downloaded on this machine.");
        }, 0);
      }
      await t.go("/wp/settings/autocomplete");
      tagsWereOn = (await tagSwitch.getAttribute("aria-checked")) === "true";
      await t.callout("list", page.locator('[data-test="tagac-status"]'), "On your computer", 5);
      await t.say("Tag names need no web at all. The tag list from Settings, Autocomplete, sits on your own computer.");
      await t.waitVoice();
      await t.uncallout("list");
      await t.callout("sw", tagSwitch, "The assistant reads it too", 5);
      await t.say("While Booru tags is on for the manager, the assistant looks tags up in it, with nothing to allow.");
      await setSwitch(t, tagSwitch, true);
      await t.waitVoice();
      await t.uncallout("sw");
    });

    await t.h.step("Look a tag up", async () => {
      await t.say("Now ask for a tag.");
      await t.click(page.locator('[data-test="topbar-ai"]'));
      await t.beat(800);
      const fresh = page.locator('[data-test="ai-chat-new"]');
      if (await fresh.isEnabled().catch(() => false)) {
        await t.click(fresh);
        await t.beat(500);
      }
      await t.fill(page.locator(field("ai-chat-input")).first(), "What's the tag for a pointed witch hat? Check my tag list.", { cps: 24 });
      await t.click(page.locator('[data-test="ai-chat-send"]'));
      await aiWait(t);
      // The lookup is local, so nothing asks to go online; a web card here means the wrong tool.
      if (await page.locator('[data-test="ai-chat-search-once"]:visible').count()) {
        throw new StepError("The assistant asked to go online instead of reading the tag list.");
      }
      const reply = page.locator('[data-test="ai-chat-reply"]').last();
      // The line says it found the tag: the take fails rather than narrate a miss.
      const said = (await reply.innerText().catch(() => "")).toLowerCase();
      if (!/witch_hat|witch hat/.test(said)) throw new StepError(`The reply doesn't give the witch hat tag: ${said.slice(0, 200)}`);
      await t.callout("ans", reply, "The tag, from your tag list", 5);
      await t.say("And here's what it found: the tag as the list writes it, ready to paste into an option.");
      await t.waitVoice();
      await t.beat(1500);
      await t.uncallout("ans");
    });

    await t.h.step("Back as it was", async () => {
      // Off camera: Booru tags goes back to how it was for the next video.
      if (!tagsWereOn) {
        await t.fastForward(async () => {
          await t.click(page.locator('[data-test="ai-chat-close"]'));
          await t.beat(500);
          await setSwitch(t, tagSwitch, false);
          await t.beat(600);
        }, 0);
      }
    });

    await t.h.step("Outro", async () => {
      await t.say("Your tag list for tag names, web tools when you want them, always after your Allow. That's the AI track.");
    });
  },
);
