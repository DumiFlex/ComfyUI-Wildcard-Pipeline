// Library 4: share and publish. Workflow files carry their modules (narrated). Export the Character
// bundle with its dependencies to a file; Import that file (tutorials/assets/character-export.json)
// and see the conflict choices; the Publish to community button; then the Community tab (browse and
// open a pack; nothing is installed or published). Without a reachable community (the cloud) the last
// step only names the tab.
import path from "node:path";
import { StepError } from "watchwright";
import { tutorial } from "../tutorial.js";


tutorial(
  "L04",
  {
    title: "Share and publish",
    description: "Share a workflow, send items as a file, bring a file in, and find packs other people published in the Community tab.",
    learn: "Workflow files, Export with dependencies, Import and its conflict choices, Publish to community, the Community tab.",
  },
  async (t) => {
    const page = t.page;

    await t.h.step("Workflows carry their items", async () => {
      await t.go("/wp/import-export");
      await t.say("The simplest way to share is the workflow itself. Every row on a Context node is a copy of its item, so a saved workflow runs on another machine even with an empty library. Rows they don't have show as missing, and right-click, Save to library adds them.");
      await t.waitVoice();
    });

    await t.h.step("Export a file", async () => {
      await t.say("To send items without a workflow, use Export. Open Bundles and tick Character.");
      const bundles = page.locator('[data-test="export-tab-section-bundle"]');
      await t.click(bundles.locator('[data-test="picker-section-toggle"]'));
      await t.beat(600);
      await t.click(page.locator('[data-test="export-tab-row-bundle-7e3d3ec2"]'));
      await t.beat(500);
      await t.say("Select with dependencies adds what it needs, so nothing is missing on the other side.");
      await t.click(page.locator('[data-test="export-select-deps"]'));
      await t.beat(700);
      await t.callout("n", page.locator('[data-test="export-tab-counter"]'), "The bundle and what it needs", 4);
      await t.waitVoice();
      await t.uncallout("n");
      await t.say("Export downloads one file to send.");
      const download = page.waitForEvent("download", { timeout: 15_000 }).catch(() => null);
      await t.click(page.locator('[data-test="export-tab-submit"]'));
      await download;
      await t.beat(800);
      await t.waitVoice();
    });

    await t.h.step("Import a file", async () => {
      await t.say("On the other side, the Import tab takes the file, or its text pasted in.");
      await t.click(page.locator('[data-test="io-tab-import"]'));
      await t.beat(800);
      const chooser = page.waitForEvent("filechooser");
      await t.click(page.locator('[data-test="import-file-btn"]'));
      await (await chooser).setFiles(path.join(t.packDir, "assets", "character-export.json"));
      await t.beat(1200);
      await t.say("Tick what to bring in, and continue.");
      await t.click(page.locator('[data-test="import-preset-all"]'));
      await t.beat(500);
      await t.click(page.locator('[data-test="import-picker-continue"]'));
      await t.beat(1200);
      await t.callout("c", page.locator('[data-test="batch-action-group"]'), "Skip, replace, or keep both", 5);
      await t.say("These are already in this library, so it asks: skip them, replace yours, or import them as new copies. An import can be undone from the message after it.");
      await t.waitVoice();
      await t.uncallout("c");
      await t.click(page.locator('[data-test="cancel-btn"]'));
      await t.beat(600);
    });

    await t.h.step("Publish to the community", async () => {
      await t.click(page.locator('[data-test="io-tab-export"]'));
      await t.beat(800);
      // The tab comes back with nothing ticked, and Publish greyed out: tick Character again.
      const row = page.locator('[data-test="export-tab-row-bundle-7e3d3ec2"]');
      if (!(await row.isVisible().catch(() => false))) {
        await t.click(page.locator('[data-test="export-tab-section-bundle"] [data-test="picker-section-toggle"]'));
        await t.beat(500);
      }
      await t.click(row);
      await t.beat(500);
      const publish = page.locator('[data-test="export-tab-publish-community"]');
      if (await publish.isDisabled()) throw new StepError("Publish to community is still greyed out.");
      await t.callout("pub", page.locator('[data-test="export-tab-publish-community"]'), "Share with everyone", 5);
      await t.say("To share with everyone, Publish to community opens the publish form with your selection filled in. Every module and bundle editor has the same button.");
      await t.waitVoice();
      await t.uncallout("pub");
    });

    await t.h.step("The Community tab", async () => {
      await t.go("/wp/community");
      await t.say("The Community tab is where people find packs. Search or browse, open one to see what's inside, and install it in one click, with the wildcards it needs.");
      const frame = page.locator("iframe.wp-community-frame");
      const ready = await frame.waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false);
      const offline = (await page.locator(".wp-community-offline").count()) > 0;
      if (ready && !offline) {
        await t.beat(2500);
        const inside = page.frameLocator("iframe.wp-community-frame");
        const card = inside.locator("a[href*='/p/'], a[href*='pack'], article").first();
        if ((await card.count()) > 0) {
          await t.callout("card", card, "A pack", 4);
          await t.waitVoice();
          await t.uncallout("card");
          await t.click(card);
          await t.beat(2000);
          await t.say("Its page lists every item, the version, and what it needs. Install puts it in your library, and updates show up when the author publishes a new version.");
        }
      }
      await t.waitVoice();
    });

    await t.h.step("Outro", async () => {
      await t.say("Send a workflow, export a file, or publish a pack. Next: backups.");
    });
  },
);
