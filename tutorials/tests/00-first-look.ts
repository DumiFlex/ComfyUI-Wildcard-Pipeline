// Get started 0: a first look around. The manager button on the canvas, the dashboard, what the
// sidebar sections hold, the library, a wildcard and its options, the docs, the settings and the
// Discord button. Nothing is changed.
import { tutorial } from "../tutorial.js";

tutorial(
  "T00",
  {
    title: "A first look around",
    description: "Where the manager is, what its sidebar holds, a wildcard's options, and where the docs and settings live.",
    learn: "Open the manager, find your library's items, and know where the docs and settings are.",
  },
  async (t) => {
    const page = t.page;
    // Sidebar links by their page: their text also holds the item count.
    const nav = (route: string) => page.locator(`a.wp-nav[href="/wp/${route}"]`).first();

    await t.h.step("The manager button", async () => {
      const button = page.getByRole("button", { name: /Wildcard Pipeline Workspace/ }).first();
      await t.say("Welcome to Wildcard Pipeline. These tutorials are recorded on version 2.22. An older version may not have everything shown here, and a newer one may have changed some of it. The videos stay on 2.22, but the built-in docs are kept up to date.");
      await t.waitVoice();
      await t.say("Before we build anything, a quick look around. Wildcard Pipeline adds a button to ComfyUI's top bar that opens the manager, where your library lives.");
      await t.hover(button);
      await t.beat(400);
      // Off the button again, so ComfyUI's own tooltip doesn't sit beside the label.
      await t.moveTo(await t.centre(button, { y: 140 }));
      await t.callout("btn", button, "Opens the manager", 6);
      await t.waitVoice();
      await t.uncallout("btn");
    });

    await t.h.step("The dashboard", async () => {
      await t.go("/wp/dashboard");
      await t.say("The manager opens in its own window, on the dashboard. The cards count what your library holds.");
      await t.beat(800);
      await t.waitVoice();
      const quick = page.locator('[data-test="dashboard-quick-create"]');
      await t.say("And from this row you can start any new item in one click.");
      await t.callout("quick", quick, "Start a new item", 8);
      await t.waitVoice();
      await t.uncallout("quick");
    });

    await t.h.step("The sidebar", async () => {
      const modules = ["wildcards", "fixed-values", "combines", "derivations", "constraints", "bundles"].map(nav);
      await t.callout("mods", modules, "Modules", 4);
      await t.say("The sidebar comes in sections. Modules are the pieces a prompt is built from.");
      await t.waitVoice();
      await t.say("Wildcards are lists to roll from. Fixed values always say the same thing. Combines join variables into a line.");
      await t.waitVoice();
      await t.say("Derivations set a variable by a rule, constraints keep picks that clash apart, and bundles group items together.");
      await t.waitVoice();
      await t.uncallout("mods");
      // Pack builder joins the group when an AI assistant is set up.
      const packs = (await nav("pack-builder").count()) > 0 && (await nav("pack-builder").isVisible());
      const library = ["templates", "categories", "tags", "health", "import-export", "test", ...(packs ? ["pack-builder"] : [])].map(nav);
      await t.callout("lib", library, "Library", 4);
      if (packs) await t.say("Library holds what works across your items: saved templates, categories and tags to sort them, a health check, import and export, the test runner, which rolls a stack many times to show how often each option comes up, and, with an AI assistant set up, the pack builder.");
      else await t.say("Library holds what works across your items: saved templates, categories and tags to sort them, a health check, import and export, and the test runner, which rolls a stack many times to show how often each option comes up.");
      await t.waitVoice();
      await t.uncallout("lib");
      const started = page.locator("a.wp-nav, button.wp-nav").filter({ hasText: /Community|Documentation|View Source|Feedback/ });
      await t.callout("start", [started.first(), started.last()], "Get started", 4);
      await t.say("Get started has the community, where people share packs, the documentation, the source code, and feedback and support.");
      await t.waitVoice();
      await t.uncallout("start");
    });

    await t.h.step("Your library", async () => {
      await t.click(nav("all"));
      await t.say("All items shows everything in your library in one list. This is the small library every tutorial uses: a role, hair, eyes, outfits, a setting, and a few rules. The next video shows how to get it.");
      await t.beat(1200);
      await t.waitVoice();
    });

    await t.h.step("A wildcard", async () => {
      // Click first, then talk about the page: a click after its line waits for the line to end,
      // so the page changed one line late.
      await t.click(nav("wildcards"));
      await t.say("Here are the wildcards.");
      await t.beat(900);
      await t.waitVoice();
      await t.click(page.locator("table").getByText("Role", { exact: true }).first());
      await t.say("Role is a list of who the picture is about: a knight, a battle mage, a forest ranger and a clockwork inventor. Its editor shows the options.");
      await t.beat(1200);
      await t.waitVoice();
      const options = page.locator('[data-test^="wc-opt-row-"]');
      await t.scrollTo(page.getByText(/^Options \(\d+\)$/).first());
      await t.callout("opts", [options.first(), options.last()], "Options, weights and chances", 4);
      await t.say("Every option has a weight. The chance column shows how often each one rolls.");
      await t.waitVoice();
      await t.uncallout("opts");
      // Each row's whole tag cell: its chips and the picker's arrow.
      const tags = page.locator(".opt-tags");
      await t.callout("tags", [tags.first(), tags.last()], "Tags", 4);
      await t.say("Tags sort options into groups. Here each role carries its own tag, and rules read those tags to pick a fitting outfit and place.");
      await t.waitVoice();
      await t.uncallout("tags");
    });

    await t.h.step("Docs and settings", async () => {
      await t.click(nav("docs"));
      await t.say("Documentation explains every node, editor and setting, with pictures.");
      await t.beat(1500);
      await t.waitVoice();
      await t.click(page.locator('[data-test="topbar-settings"]'));
      await t.say("The gear opens the settings.");
      await t.beat(1200);
      await t.waitVoice();
      const sections = page.locator('[data-test^="settings-nav-"]');
      await t.callout("sections", [sections.first(), sections.last()], "Settings", 4);
      await t.say("Besides the look of the manager, they cover how editors and autocomplete behave, the nodes on the canvas, the test runner, the AI assistant, your database and its backups, and moving settings to another machine.");
      await t.waitVoice();
      await t.uncallout("sections");
      const discord = page.locator(".wp-topbar__discord").first();
      await t.hover(discord);
      await t.callout("discord", discord, "Help on Discord", 6);
      await t.say("Stuck? The Discord button in the top bar is the fastest way to ask a person.");
      await t.waitVoice();
      await t.uncallout("discord");
    });

    await t.h.step("Outro", async () => {
      await t.say("That's the tour. Next: bring the tutorial library into yours, so you can follow along.");
    });
  },
);
