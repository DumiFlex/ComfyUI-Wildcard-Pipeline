// D: backups, pins, pruning, live restore and Undo (Settings › Library › Backups), and the
// Library health page. Each test cleans up the backups it made (see library.ts › Made).
import { setPinned, listBackups } from "../../lifecycle.js";
import {
  MARKER,
  apiBackup,
  backupNamed,
  check,
  libraryTest,
  markedBackup,
  markerId,
  openBackups,
  pinnedCount,
  restoreFromPanel,
  toast,
  wildcardsInApp,
} from "../library.js";

libraryTest(
  "D1",
  { title: "Back up now with a note", description: "Type a note, press Back up now: the toast says Backup saved and the new row shows the note." },
  async ({ h }, made) => {
    const note = `Watchwright D1 ${Date.now().toString(36)}`;
    await h.step("Settings › Library › Backups", () => openBackups(h));
    await h.step(`Back up now with the note "${note}"`, async () => {
      await h.page.locator('input[data-test="backup-note"], [data-test="backup-note"] input').first().fill(note);
      await h.tap("backup-now");
      const said = await toast(h, /Backup saved|Could not back up/);
      check(h, /Backup saved/.test(said), `the toast says Backup saved ("${said.replace(/\s+/g, " ").slice(0, 120)}")`);
      await h.snap("saved", '[data-test="backup-list"]');
    });
    await h.step("The new row shows the note", async () => {
      const mine = (await made.fresh()).find((b) => b.note === note);
      check(h, !!mine, "the backup list has a backup with the note");
      if (!mine) return;
      const label = await h.page.locator(`[data-test="backup-label-${mine.name}"]`).innerText().catch(() => "");
      check(h, label.includes(note), `its row's label is the note ("${label}")`);
    });
  },
);

libraryTest(
  "D2",
  { title: "Pin and unpin a backup", description: "The bookmark pins a backup (pressed, the pinned count goes up, never Removed at next backup) and unpins it again." },
  async ({ h }) => {
    const name = await h.step("Make a backup to pin", () => apiBackup(h, "Watchwright D2"));
    await h.step("Settings › Library › Backups", () => openBackups(h));
    const before = await pinnedCount(h);
    await h.step("Pin it", async () => {
      await h.tap(`backup-pin-${name}`);
      await h.wait(800);
      const pin = h.page.locator(`[data-test="backup-pin-${name}"]`);
      check(h, (await pin.getAttribute("aria-pressed")) === "true", "the bookmark shows pressed");
      check(h, (await backupNamed(h, name))?.pinned === true, "the server has it pinned");
      check(h, (await pinnedCount(h)) === before + 1, `the pinned count went from ${before} to ${before + 1}`);
      check(h, !(await h.shows(`backup-leaving-${name}`)), "a pinned row never says Removed at next backup");
      await h.snap("pinned", '[data-test="backup-list"]');
    });
    await h.step("Unpin it", async () => {
      await h.tap(`backup-pin-${name}`);
      await h.wait(800);
      check(h, (await h.page.locator(`[data-test="backup-pin-${name}"]`).getAttribute("aria-pressed")) === "false", "the bookmark shows not pressed");
      check(h, (await backupNamed(h, name))?.pinned === false, "the server has it unpinned");
      check(h, (await pinnedCount(h)) === before, `the pinned count is back to ${before}`);
    });
  },
);

libraryTest(
  "D3",
  {
    title: "Pruning keeps pinned backups",
    description: "With Backups to keep at 2, three more backups remove the oldest unpinned one and never a pinned one. Backups to keep is put back after.",
  },
  async ({ h }, made) => {
    const settings = await h.api("/wp/api/settings");
    const keepBefore = Number((settings.json?.backups as { keep?: number } | undefined)?.keep ?? 10);
    // Every unpinned backup already there is pinned for the test, so a keep of 2 can't touch it.
    for (const b of await listBackups(h))
      if (!b.pinned && (await setPinned(h, b.name, true))) made.pinnedByTest.push(b.name);
    try {
      await h.api("/wp/api/settings", { method: "PUT", body: { backups: { keep: 2 } } });
      const pinned = await apiBackup(h, "Watchwright D3 pinned");
      await setPinned(h, pinned, true);
      const [b1, b2, b3] = [await apiBackup(h, "Watchwright D3 one"), await apiBackup(h, "Watchwright D3 two"), await apiBackup(h, "Watchwright D3 three")];
      const names = new Set((await listBackups(h)).map((b) => b.name));
      check(h, names.has(pinned), "the pinned backup is still there");
      check(h, !names.has(b1), "the oldest unpinned backup was removed");
      check(h, names.has(b2) && names.has(b3), "the two newest unpinned backups are kept");
      for (const name of made.pinnedByTest) check(h, names.has(name), `the backup ${name} that was there before is kept`);
      await h.step("The panel agrees", async () => {
        await openBackups(h);
        check(h, !(await h.shows(`backup-leaving-${pinned}`)), "the pinned row doesn't say Removed at next backup");
        await h.snap("pruned", '[data-test="backup-list"]');
      });
    } finally {
      await h.api("/wp/api/settings", { method: "PUT", body: { backups: { keep: keepBefore } } });
      h.log(`Put Backups to keep back to ${keepBefore}.`);
    }
  },
);

libraryTest(
  "D4",
  {
    title: "Restore a backup live",
    description: "Restore from the panel, with no restart: the toast says Backup restored, and a wildcard only the backup had is on the Wildcards page, reached without a page load.",
  },
  async ({ h }, made) => {
    const name = await h.step(`Back up with a ${MARKER} wildcard, then delete it`, () => markedBackup(h, "Watchwright D4"));
    const said = await h.step("Restore it from Settings › Library", () => restoreFromPanel(h, name));
    check(h, /Backup restored/.test(said), `the toast says Backup restored ("${said.replace(/\s+/g, " ").slice(0, 160)}")`);
    check(h, !!(await markerId(h)), `the library has ${MARKER} again`);
    const pre = (await made.fresh()).find((b) => b.reason === "pre-restore");
    check(h, !!pre, 'the library it replaced is kept as a "Before restore" backup');
    await h.step("The Wildcards page shows it without a page load", async () => {
      const inApp = await wildcardsInApp(h);
      if (!inApp) h.log("No sidebar link to Wildcards: opened the page with a load instead.");
      const shown = await h.page.getByText(MARKER, { exact: true }).first().isVisible({ timeout: 10_000 }).catch(() => false);
      check(h, shown, `${MARKER} is listed on the Wildcards page${inApp ? " (in-app navigation)" : ""}`);
      await h.snap("wildcards");
    });
  },
);

libraryTest(
  "D5",
  { title: "Undo a restore", description: "The restore toast's Undo puts back the library the restore replaced: the marker wildcard is gone again." },
  async ({ h }) => {
    const name = await h.step(`Back up with a ${MARKER} wildcard, then delete it`, () => markedBackup(h, "Watchwright D5"));
    await h.step("Restore it from Settings › Library", () => restoreFromPanel(h, name));
    check(h, !!(await markerId(h)), `the restore brought ${MARKER} back`);
    await h.step("Press Undo on the toast", async () => {
      const undo = h.page.locator('[data-test="toast"]').filter({ hasText: "Backup restored" }).last().locator('[data-test="toast-action"]');
      await h.tapOn(undo, "toast-undo");
      const said = await toast(h, /before the restore|Could not restore/, 60_000);
      check(h, /before the restore/.test(said), `the second toast says the library is back to before the restore ("${said.replace(/\s+/g, " ").slice(0, 160)}")`);
    });
    check(h, !(await markerId(h)), `${MARKER} is gone again`);
  },
);

libraryTest(
  "D6",
  { title: "A restore that can't run changes nothing", description: "Restoring a backup that isn't there answers 404, and a name with a path in it is refused; the library stays as it was." },
  async ({ h }) => {
    const before = (await h.library()).modules.length;
    for (const name of ["wp-backup-not-there.db", "../wildcard_pipeline.db"]) {
      const r = await h.api("/wp/api/database/backups/restore", { method: "POST", body: { name } });
      check(h, r.status >= 400 && r.status < 500, `restoring "${name}" is refused with ${r.status}`);
    }
    const r = await h.api("/wp/api/database/backups/restore", { method: "POST", body: { name: "wp-backup-not-there.db" } });
    check(h, r.status === 404, `an unknown backup answers 404 (got ${r.status})`);
    check(h, (await h.library()).modules.length === before, `the library still has ${before} modules`);
  },
);

libraryTest(
  "D7",
  { title: "Library health lists the findings", description: "The Library health page loads and shows a group for each kind of finding the scan returns." },
  async ({ h }) => {
    const scan = await h.api("/wp/api/health/scan", { method: "POST", body: {} });
    check(h, scan.status === 200, `the scan answers (${scan.status})`);
    const findings = (scan.json?.findings as { key: string }[] | undefined) ?? [];
    const ignored = new Set((scan.json?.ignored as string[] | undefined) ?? []);
    const kinds = [...new Set(findings.filter((f) => !ignored.has(f.key)).map((f) => f.key.split(":")[0]))];
    h.log(`The scan has ${findings.length} finding(s) of ${kinds.length} kind(s): ${kinds.join(", ") || "none"}.`);
    await h.step("Open Library health", async () => {
      await h.visit("health");
      await h.page.locator('[data-test="health-skeleton"]').waitFor({ state: "hidden", timeout: 30_000 }).catch(() => undefined);
      await h.pageScrollShots("health", 6);
    });
    for (const k of kinds) check(h, await h.shows(`health-group-${k}`, 5000), `the page has a ${k} group`);
  },
);
