// AI 4: web search and tag lookup. Settings › AI assistant: a search engine (SearXNG or a key), the
// Danbooru tag lookup (turned on here, off again at the end), "Don't ask before web calls" left off,
// the delete and auto-apply permissions. Then a chat ask that looks a tag up, after Allow.
import { aiWait, tutorial } from "../tutorial.js";

const field = (id: string) => `textarea[data-test="${id}"], [data-test="${id}"] textarea, input[data-test="${id}"], [data-test="${id}"] input`;

tutorial(
  "AI4",
  {
    title: "AI assistant: web search and tag lookup",
    description: "Let the assistant search the web and look up Danbooru tags, always after you allow it, and choose what else it may do.",
    learn: "Search engine settings, the Danbooru lookup, Allow before each web call, delete and auto-apply permissions.",
  },
  async (t) => {
    const page = t.page;
    const danbooru = page.locator('[data-test="ai-danbooru"]');
    const isOn = async () => (await danbooru.getAttribute("aria-checked").catch(() => null)) === "true" || (await danbooru.locator("input").isChecked().catch(() => false));
    let turnedOn = false;

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
      await t.say("Danbooru tag lookup reads tags, their wiki and related tags. Read only, and never more than one call a second. Turn it on.");
      if (!(await isOn())) {
        await t.click(danbooru);
        turnedOn = true;
        await t.beat(800);
      }
      await t.waitVoice();
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

    await t.h.step("Look a tag up", async () => {
      await t.say("Now ask for a tag.");
      await t.click(page.locator('[data-test="topbar-ai"]'));
      await t.beat(800);
      const fresh = page.locator('[data-test="ai-chat-new"]');
      if (await fresh.isEnabled().catch(() => false)) {
        await t.click(fresh);
        await t.beat(500);
      }
      await t.fill(page.locator(field("ai-chat-input")).first(), "Look up the Danbooru tag for a pointed witch hat.", { cps: 24 });
      await t.click(page.locator('[data-test="ai-chat-send"]'));
      await aiWait(t);
      const allow = page.locator('[data-test="ai-chat-search-once"]:visible').last();
      if (await allow.isVisible().catch(() => false)) {
        await t.callout("allow", page.locator('[data-test="ai-chat-search"]').last(), "It asks first", 5);
        await t.say("It asks before it goes online, and shows what it will look up. Allow once.");
        await t.waitVoice();
        await t.uncallout("allow");
        await t.click(allow);
        await aiWait(t);
      }
      await t.callout("ans", page.locator('[data-test="ai-chat-reply"]').last(), "The tag, from Danbooru", 5);
      await t.waitVoice();
      await t.uncallout("ans");
    });

    await t.h.step("Back as it was", async () => {
      if (turnedOn || (await isOn())) {
        await t.click(page.locator('[data-test="ai-chat-close"]'));
        await t.beat(500);
        await t.scrollTo(danbooru, { at: 0.4 });
        await t.click(danbooru);
        await t.beat(600);
      }
    });

    await t.h.step("Outro", async () => {
      await t.say("Web tools when you want them, always after your Allow. That's the AI track.");
    });
  },
);
