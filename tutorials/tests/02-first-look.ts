// Tutorial 2: a first look around. The manager button on the canvas, the dashboard, what the
// sidebar holds, a wildcard and its options, the docs and the settings. Nothing is changed.
import { tutorial } from "../tutorial.js";

tutorial(
  "T02",
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
      await t.say("Wildcard Pipeline adds a button to ComfyUI's top bar. It opens the manager, where your library lives.");
      await t.hover(button);
      await t.callout("btn", button, "Opens the manager", 6);
      await t.waitVoice();
      await t.uncallout("btn");
    });

    await t.h.step("The dashboard", async () => {
      await t.say("The manager opens in its own window, on the dashboard.");
      await t.go("/wp/dashboard");
      await t.beat(800);
      const quick = page.locator('[data-test="dashboard-quick-create"]');
      await t.callout("quick", quick, "Start a new item", 8);
      await t.say("From here you can start any new item in one click.");
      await t.waitVoice();
      await t.uncallout("quick");
    });

    await t.h.step("The sidebar", async () => {
      const modules = ["wildcards", "fixed-values", "combines", "derivations", "constraints", "bundles"].map(nav);
      await t.callout("mods", modules, "Modules", 4);
      await t.say("The sidebar lists your modules: the pieces a prompt is built from.");
      await t.waitVoice();
      await t.say("Wildcards are lists to roll from. Fixed values always say the same thing. Combines join variables into a line.");
      await t.waitVoice();
      await t.say("Derivations set a variable by a rule, constraints keep picks that clash apart, and bundles group items together.");
      await t.waitVoice();
      await t.uncallout("mods");
    });

    await t.h.step("A wildcard", async () => {
      await t.say("Let's open the wildcards.");
      await t.click(nav("wildcards"));
      await t.beat(900);
      await t.say("Hero is a list of heroes. Open it to see its options.");
      await t.click(page.locator("table").getByText("Hero", { exact: true }).first());
      await t.beat(1200);
      const options = page.locator('[data-test^="wc-opt-row-"]');
      await t.scrollTo(page.getByText(/^Options \(\d+\)$/).first());
      await t.callout("opts", [options.first(), options.last()], "Options, weights and chances", 4);
      await t.say("Every option has a weight. The chance column shows how often each one rolls.");
      await t.waitVoice();
      await t.uncallout("opts");
      const tags = page.locator('[data-test^="opt-tags-"]');
      await t.callout("tags", [tags.first(), tags.last()], "Tags", 6);
      await t.say("Tags sort options into groups, like noble or urban. Rules can read them later.");
      await t.waitVoice();
      await t.uncallout("tags");
    });

    await t.h.step("Docs and settings", async () => {
      await t.say("Documentation explains every node, editor and setting, with pictures.");
      await t.click(nav("docs"));
      await t.beat(1500);
      await t.say("And the gear opens the settings: themes, density, and how the canvas widgets look.");
      await t.click(page.locator('[data-test="topbar-settings"]'));
      await t.beat(1500);
    });

    await t.h.step("Outro", async () => {
      await t.say("That's the tour. Next, we'll make a wildcard of our own.");
    });
  },
);
