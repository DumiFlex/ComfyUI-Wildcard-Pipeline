// Get started 0: the tutorial library. Every video uses the same small library (library.json, shipped
// with the videos as "WP Tutorials library.json"). A new install starts empty, so this one empties the
// library off camera, shows the empty dashboard, imports the file on Import / Export › Import, and
// shows the items. It names the example workflows' "Add to my library" note button as the other way.
// If the take breaks halfway, the library is loaded back so the next tutorials still have it.
import path from "node:path";
import { resetLibrary } from "../../bench/shared.js";
import { tutorial } from "../tutorial.js";

tutorial(
  "T00",
  {
    title: "Before you start: the tutorial library",
    description: "Every tutorial uses the same small library. Import it once so you can follow along.",
    learn: "An empty library, Import / Export › Import, importing a file, where the items show up.",
  },
  async (t) => {
    const page = t.page;
    const fixture = path.join(t.packDir, "library.json");
    // Off camera: an empty library, as on a new install.
    const lib = await t.h.library();
    for (const x of lib.bundles) await t.h.api(`/wp/api/bundles/${x.id}`, { method: "DELETE" });
    for (const x of lib.templates) await t.h.api(`/wp/api/templates/${x.id}`, { method: "DELETE" });
    for (const type of ["constraint", "derivation", "combine", "fixed_values", "wildcard"])
      for (const x of lib.modules.filter((m) => m.type === type)) await t.h.api(`/wp/api/modules/${x.id}`, { method: "DELETE" });

    let done = false;
    try {
      await t.h.step("An empty library", async () => {
        await t.go("/wp/");
        await t.say("The tutorials all use the same small library: a hero, a setting, outfits, and a few rules. A new install starts with an empty library, like this one.");
        await t.waitVoice();
        await t.say("So first, bring the tutorial library in. The file, WP Tutorials library dot json, comes with the videos.");
        await t.waitVoice();
      });

      await t.h.step("Import the file", async () => {
        await t.go("/wp/import-export");
        await t.say("Open Import and Export, then the Import tab.");
        await t.click(page.locator('[data-test="io-tab-import"]'));
        await t.beat(800);
        await t.waitVoice();
        await t.say("Choose the file.");
        const chooser = page.waitForEvent("filechooser");
        await t.click(page.locator('[data-test="import-file-btn"]'));
        await (await chooser).setFiles(fixture);
        await t.beat(1500);
        await t.waitVoice();
        await t.say("It lists what's inside. Select all, and continue.");
        await t.click(page.locator('[data-test="import-preset-all"]'));
        await t.beat(600);
        await t.click(page.locator('[data-test="import-picker-continue"]'));
        await t.beat(1500);
        // With an empty library nothing clashes, so Continue imports straight away; a clash opens a
        // dialog with its own Import button.
        const commit = page.locator('[data-test="commit-btn"]');
        if (await commit.isVisible().catch(() => false)) await t.click(commit);
        await t.beat(1200);
        const toast = page.getByText("Import committed").first();
        const shown = await toast.isVisible().catch(() => false);
        if (shown) await t.callout("done", toast, "Imported, with Undo", 5);
        await t.say("Nothing clashes with an empty library, so it goes straight in. The message has Undo, in case you change your mind.");
        await t.waitVoice();
        if (shown) await t.uncallout("done");
      });

      await t.h.step("The items", async () => {
        await t.go("/wp/");
        await t.say("The wildcards, rules and bundles are in your library now, and every tutorial can use them.");
        await t.beat(1500);
        await t.waitVoice();
        await t.say("The example workflows carry their lists too. Their first note has an Add to my library button that saves them, if you'd rather start there.");
        await t.waitVoice();
      });
      done = true;
    } finally {
      const after = await t.h.library();
      if (!done || after.modules.length < 10) await resetLibrary(t.h, fixture, { backupFirst: false });
    }

    await t.h.step("Outro", async () => {
      await t.say("That's all the setup. Next: your first random prompt.");
    });
  },
);
