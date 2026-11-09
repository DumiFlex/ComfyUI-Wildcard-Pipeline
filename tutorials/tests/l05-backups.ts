// Library 5: backups. Settings › Library & data: automatic backups (daily, how many to keep), Back up
// now with a note, a change (Role loses "a clockwork inventor"), Restore of the noted backup (live, no
// restart, with its own "Before restore" backup), pins, then the database's location and
// maintenance, and exporting settings (Advanced). Backups the recording's own lifecycle made are
// hidden from the list so it shows only this video's.
import { tutorial } from "../tutorial.js";

tutorial(
  "L05",
  {
    title: "Backups",
    description: "Keep your library safe: automatic backups, a backup before a big change, restoring one without a restart, and where the library lives.",
    learn: "Automatic and manual backups, notes and pins, live restore, the database location and maintenance, exporting your settings.",
  },
  async (t) => {
    const page = t.page;
    const list = page.locator('[data-test="backup-list"]');
    // Rows from before this video (the recorder's own safety backups) stay out of the picture.
    // Hides the backups from before the video (all but the one it makes, by its note).
    const hideOld = async () =>
      page.evaluate(() => {
        for (const li of Array.from(document.querySelectorAll('[data-test="backup-list"] > li'))) {
          if (!li.textContent?.includes("Before my big edit")) (li as HTMLElement).style.display = "none";
        }
        for (const sel of ['[data-test="backup-show-all"]', '[data-test="backup-pinned-count"]']) {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (el) el.style.visibility = "hidden";
        }
      });

    await t.h.step("Automatic backups", async () => {
      await t.go("/wp/settings/library");
      await hideOld();
      await t.say("Your library is backed up for you. Open Settings, Library and data.");
      await t.scrollTo(page.locator('[data-test="backups-enabled"]'), { at: 0.3 });
      await t.callout("auto", [page.locator('[data-test="backups-enabled"]'), page.locator('[data-test="backups-keep"]')], "On, daily, keeps the last 7", 6);
      await t.say("Backups are on, one a day, and it keeps the last seven. Raise that if you like.");
      await t.waitVoice();
      await t.uncallout("auto");
    });

    await t.h.step("Back up before a big change", async () => {
      await t.say("Before a big change, back up by hand, with a note so you find it again.");
      await t.fill(page.locator('[data-test="backup-note"]'), "Before my big edit", { cps: 14 });
      await t.click(page.locator('[data-test="backup-now"]'));
      await t.beat(1500);
      const mine = list.locator("> li").first();
      await t.callout("mine", mine, "Your backup, with its note", 4);
      await t.waitVoice();
      await t.uncallout("mine");
      await t.say("The pin keeps a backup for good: pinned ones never count toward the seven.");
      await t.callout("pin", mine.locator('[data-test^="backup-pin-"]'), "Keep it for good", 3);
      await t.click(mine.locator('[data-test^="backup-pin-"]'));
      await t.beat(700);
      await t.waitVoice();
      await t.uncallout("pin");
    });

    await t.h.step("Restore, without a restart", async () => {
      await t.say("Now the big edit: Role loses the clockwork inventor.");
      await t.go("/wp/wildcards/808878ba/edit");
      await t.beat(900);
      const row = page.locator('[data-test="wc-opt-row-3"]');
      await t.hover(row);
      await t.beat(400);
      await t.click(row.getByRole("button", { name: "Remove option" }));
      await t.beat(500);
      await t.click(page.locator('[data-test="save-btn"]'));
      await t.beat(1200);
      await t.say("Changed your mind? Back in Library and data, press Restore on the backup.");
      await t.go("/wp/settings/library");
      await hideOld();
      await t.scrollTo(list, { at: 0.4 });
      const noted = list.locator("> li", { hasText: "Before my big edit" }).first();
      await t.click(noted.locator('[data-test^="backup-restore-"]'));
      await t.beat(800);
      await t.callout("dlg", page.locator('[data-test="confirm-body"]'), "Right away, no restart", 5);
      await t.say("It goes back right away, with no restart, and backs up the current library first, so a restore can be undone too.");
      await t.waitVoice();
      await t.uncallout("dlg");
      await t.click(page.locator('[data-test="confirm-confirm"]'));
      await t.beat(1800);
      await t.go("/wp/wildcards/808878ba/edit");
      await t.beat(900);
      await t.callout("back", page.locator('[data-test="wc-opt-row-3"]'), "The inventor is back", 4);
      await t.waitVoice();
      await t.uncallout("back");
    });

    await t.h.step("Where the library lives", async () => {
      await t.go("/wp/settings/library");
      await hideOld();
      await t.say("The same page shows the database: its file, its size, and maintenance tools. Integrity check finds damage, Vacuum makes the file smaller.");
      // The file details and Maintenance sit in folds: open both.
      for (const summary of await page.locator(".wp-db__details > summary").all()) {
        if (!(await summary.evaluate((el) => (el.parentElement as HTMLDetailsElement).open))) await t.click(summary);
        await t.beat(300);
      }
      await t.scrollTo(page.locator('[data-test="database-file"]'), { at: 0.3 });
      await t.callout("db", [page.locator('[data-test="database-file"]'), page.locator('[data-test="database-run-integrity"]')], "The file, and its upkeep", 5);
      await t.waitVoice();
      await t.uncallout("db");
      await t.say("And where it's kept: per ComfyUI install, shared by every install on this PC, or inside the plugin's folder.");
      await t.scrollTo(page.locator('[data-test="location-option-user"]'), { at: 0.4 });
      await t.callout("loc", [page.locator('[data-test="location-option-user"]'), page.locator('[data-test="location-option-root"]')], "Per install is the default", 5);
      await t.waitVoice();
      await t.uncallout("loc");
    });

    await t.h.step("Your settings too", async () => {
      await t.go("/wp/settings/advanced");
      await t.say("Your settings aren't in the library. Advanced has Export settings and Import settings, to move them to another PC.");
      await t.scrollTo(page.locator('[data-test="settings-export"]'), { at: 0.4 });
      await t.callout("set", [page.locator('[data-test="settings-export"]'), page.locator('[data-test="settings-import"]')], "Settings to a file, and back", 5);
      await t.waitVoice();
      await t.uncallout("set");
    });

    await t.h.step("Outro", async () => {
      await t.say("Daily backups, a noted one before big changes, and a restore that takes a second. Next: keeping a big library tidy.");
    });
  },
);
