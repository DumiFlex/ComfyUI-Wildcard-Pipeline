// What the library pack's tests share: the Backups panel (Settings › Library), backups made and
// cleaned up through the API, and a marker wildcard that shows whether a restore landed.
import { StepError, test, type Helpers, type TestContext, type TestMeta } from "watchwright";
import { listBackups, setPinned, type BackupEntry } from "../lifecycle.js";

export const MARKER = "Ww Restore Marker";

/** A finding when `ok` is false, else an OK line in the log. */
export function check(h: Helpers, ok: boolean, detail: string): void {
  if (ok) h.log(`OK: ${detail}`);
  else h.flag("check-failed", detail);
}

/** Declares a library test: one attempt, and whatever it made is cleaned up after (see `Made`). */
export function libraryTest(id: string, meta: TestMeta, body: (t: TestContext, made: Made) => Promise<void>): void {
  test(id, { runs: 1, section: "Library safety", ...meta }, async (t) => {
    const made = new Made(t.h);
    await made.start();
    try {
      await body(t, made);
    } finally {
      await made.cleanUp();
    }
  });
}

/**
 * The backups an attempt made (by hand, by a restore, by Undo) and the marker wildcard: everything
 * new since the attempt started is unpinned and deleted at its end, and the marker goes.
 */
export class Made {
  private before = new Set<string>();
  /** Backups the test pinned that it found unpinned (put back to unpinned at the end). */
  readonly pinnedByTest: string[] = [];
  constructor(private h: Helpers) {}

  async start(): Promise<void> {
    this.before = new Set((await listBackups(this.h)).map((b) => b.name));
  }

  /** Backups made since the attempt started, newest first. */
  async fresh(): Promise<BackupEntry[]> {
    return (await listBackups(this.h)).filter((b) => !this.before.has(b.name));
  }

  async cleanUp(): Promise<void> {
    const h = this.h;
    for (const name of this.pinnedByTest) await setPinned(h, name, false);
    for (const b of await this.fresh()) {
      if (b.pinned) await setPinned(h, b.name, false);
      await h.api(`/wp/api/database/backups/${encodeURIComponent(b.name)}`, { method: "DELETE" });
    }
    await dropMarker(h);
  }
}

/** A backup with a note, through the API. */
export async function apiBackup(h: Helpers, note: string): Promise<string> {
  const r = await h.api("/wp/api/database/backups", { method: "POST", body: { note } });
  const name = r.json?.name as string | undefined;
  if (r.status >= 300 || !name) throw new StepError(`The backup failed (${r.status}): ${r.text.slice(0, 200)}`);
  return name;
}

export async function backupNamed(h: Helpers, name: string): Promise<BackupEntry | undefined> {
  return (await listBackups(h)).find((b) => b.name === name);
}

/** Settings › Library with the Backups panel loaded and every backup listed. */
export async function openBackups(h: Helpers): Promise<void> {
  await h.visit("settings/library");
  await h.page.locator('[data-test="backup-list"], [data-test="backup-empty"]').first().waitFor({ state: "visible", timeout: 20_000 });
  if (await h.shows("backup-show-all")) {
    const text = await h.page.locator('[data-test="backup-show-all"]').innerText();
    if (/Show all/.test(text)) await h.tap("backup-show-all");
  }
}

/** The "N pinned" count beside Back up now (0 when it isn't shown). */
export async function pinnedCount(h: Helpers): Promise<number> {
  const el = h.page.locator('[data-test="backup-pinned-count"]');
  if (!(await el.isVisible().catch(() => false))) return 0;
  return Number(/\d+/.exec(await el.innerText())?.[0] ?? 0);
}

/** Waits for a toast whose text matches; returns its text ("" when none came). */
export async function toast(h: Helpers, match: RegExp, timeout = 15_000): Promise<string> {
  const card = h.page.locator('[data-test="toast"]').filter({ hasText: match }).last();
  return card
    .waitFor({ state: "visible", timeout })
    .then(() => card.innerText())
    .catch(() => "");
}

// ---- the marker wildcard ------------------------------------------------------------------------

export async function markerId(h: Helpers): Promise<string | null> {
  const lib = await h.library();
  return lib.modules.find((m) => m.type === "wildcard" && m.name === MARKER)?.id ?? null;
}

export async function addMarker(h: Helpers): Promise<void> {
  if (await markerId(h)) return;
  const r = await h.api("/wp/api/modules", {
    method: "POST",
    body: {
      type: "wildcard",
      name: MARKER,
      description: "Made by the library safety pack; a restore test deletes it.",
      tags: ["bench"],
      payload: { options: [{ id: "o001", value: "restore marker", weight: 1 }], var_binding: "ww_restore_marker" },
    },
  });
  if (r.status >= 300) throw new StepError(`Couldn't add the marker wildcard (${r.status}): ${r.text.slice(0, 200)}`);
}

export async function dropMarker(h: Helpers): Promise<void> {
  const id = await markerId(h);
  if (id) await h.api(`/wp/api/modules/${id}`, { method: "DELETE" });
}

/**
 * Adds the marker, backs the library up (so the backup has it) and deletes the marker again:
 * restoring the backup brings it back. Returns the backup's name.
 */
export async function markedBackup(h: Helpers, note: string): Promise<string> {
  await addMarker(h);
  const name = await apiBackup(h, note);
  await dropMarker(h);
  if (await markerId(h)) throw new StepError("The marker wildcard didn't go.");
  return name;
}

/** Restores `name` from its row in the panel: Restore, then the confirm's Restore. Returns the toast's text. */
export async function restoreFromPanel(h: Helpers, name: string): Promise<string> {
  await openBackups(h);
  await h.tap(`backup-restore-${name}`);
  await h.tap("confirm-confirm");
  const text = await toast(h, /Backup restored|Could not restore/, 60_000);
  await h.snap("restored", '[data-test="toast"]');
  return text;
}

/** The Wildcards page reached by the app's own navigation (no page load), when it has a link to it. */
export async function wildcardsInApp(h: Helpers): Promise<boolean> {
  const link = h.page.locator('a[href$="/wildcards"], a[href$="#/wildcards"]').first();
  if (!(await link.isVisible().catch(() => false))) {
    await h.visit("wildcards");
    return false;
  }
  await h.tapOn(link, "nav-wildcards");
  await h.page.waitForURL(/wildcards/, { timeout: 10_000 }).catch(() => undefined);
  await h.wait(800);
  return true;
}
